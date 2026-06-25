/**
 * Fixes three data quality issues in the athlete DB:
 *   1. team:             picks current team (no P582 end date) or longest-tenure (for retired)
 *   2. yearsActive:      uses P2032 (career end) for retired players instead of CURRENT_YEAR
 *   3. allStarSelections: counts P166 awards that are instances of the sport's All-Star game
 *
 * Strategy: SPARQL batch for QID lookup + wbgetentities batch for claims.
 * This is far more reliable than per-athlete wbsearchentities calls.
 *
 * Run:  npx tsx scripts/fixAthleteData.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const UA = "celebridle-fix/1.0 (samuel.smith2204@gmail.com)";
const SPARQL_EP = "https://query.wikidata.org/sparql";
const CURRENT_YEAR = 2026;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// P31 (instance-of) QID for each sport's All-Star game/event
const ALL_STAR_INSTANCE_QID: Record<string, string> = {
  NBA: "Q137341",  // NBA All-Star Game
  NFL: "Q786705",  // Pro Bowl (NFL All-Star)
  MLB: "Q1069698", // Major League Baseball All-Star Game
  NHL: "Q29144",   // National Hockey League All-Star Game
};

// ── SPARQL helper with retry ──────────────────────────────────────────────────
async function sparql(query: string, tag = "query"): Promise<any[]> {
  const url = `${SPARQL_EP}?query=${encodeURIComponent(query.trim())}&format=json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 6000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      });
      if (res.status === 429 || res.status === 503 || res.status === 502) {
        console.warn(`  SPARQL [${tag}] ${res.status} — retry ${attempt + 1}`);
        continue;
      }
      if (!res.ok) { console.warn(`  SPARQL [${tag}] HTTP ${res.status}`); return []; }
      const data: any = await res.json();
      return data.results?.bindings ?? [];
    } catch (e: any) {
      console.warn(`  SPARQL [${tag}] error: ${e.message}`);
    }
  }
  return [];
}

// ── SPARQL QID lookup: athlete names → QIDs ──────────────────────────────────
// Filters by P569 (birth date = human) and sports-related P106 (occupation).
async function lookupQids(names: string[]): Promise<Map<string, string>> {
  const qidMap = new Map<string, string>();
  const CHUNK = 80;
  const OCCUPATIONS = [
    "wd:Q2066131",   // athlete
    "wd:Q3665646",   // basketball player
    "wd:Q628099",    // American football player
    "wd:Q13141064",  // baseball player
    "wd:Q19204627",  // ice hockey player
  ].join(" ");

  for (let i = 0; i < names.length; i += CHUNK) {
    await sleep(1500);
    const chunk = names.slice(i, i + CHUNK);
    const nameList = chunk.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");
    const q = `
SELECT DISTINCT ?entity ?label WHERE {
  VALUES ?label { ${nameList} }
  ?entity rdfs:label ?label .
  FILTER(LANG(?label) = "en")
  ?entity wdt:P569 ?birth .
  ?entity wdt:P106 ?occ .
  VALUES ?occ { ${OCCUPATIONS} }
}`;
    const rows = await sparql(q, `qid-${i}`);
    let added = 0;
    for (const r of rows) {
      const name: string = r.label?.value ?? "";
      const qid: string = r.entity?.value?.split("/").pop() ?? "";
      if (name && qid && !qidMap.has(name)) { qidMap.set(name, qid); added++; }
    }
    console.log(`  QID lookup [${i + 1}–${Math.min(i + CHUNK, names.length)}/${names.length}]: +${added} (total ${qidMap.size})`);
  }
  return qidMap;
}

// ── Batch wbgetentities: QIDs → claims ───────────────────────────────────────
async function batchGetClaims(qids: string[]): Promise<Map<string, any>> {
  const result = new Map<string, any>();
  const BATCH = 50;
  for (let i = 0; i < qids.length; i += BATCH) {
    await sleep(600);
    const batch = qids.slice(i, i + BATCH);
    try {
      const url =
        `https://www.wikidata.org/w/api.php?action=wbgetentities` +
        `&ids=${encodeURIComponent(batch.join("|"))}&props=claims&format=json`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) { console.warn(`  wbgetentities HTTP ${res.status}`); continue; }
      const data: any = await res.json();
      for (const [qid, entity] of Object.entries(data.entities ?? {})) {
        result.set(qid, (entity as any).claims ?? {});
      }
    } catch (e: any) {
      console.warn(`  wbgetentities error: ${e.message}`);
    }
    process.stdout.write(`  Claims: ${Math.min(i + BATCH, qids.length)}/${qids.length}\r`);
  }
  console.log();
  return result;
}

// ── Batch wbgetentities: QIDs → EN labels ────────────────────────────────────
async function batchGetLabels(qids: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const BATCH = 50;
  for (let i = 0; i < qids.length; i += BATCH) {
    await sleep(400);
    const batch = qids.slice(i, i + BATCH);
    try {
      const url =
        `https://www.wikidata.org/w/api.php?action=wbgetentities` +
        `&ids=${encodeURIComponent(batch.join("|"))}&props=labels&languages=en&format=json`;
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const [qid, entity] of Object.entries(data.entities ?? {})) {
        const label: string | undefined = (entity as any).labels?.en?.value;
        if (label) result.set(qid, label);
      }
    } catch (e: any) {
      console.warn(`  batchGetLabels error: ${e.message}`);
    }
  }
  return result;
}

// ── SPARQL: count All-Star selections per sport ───────────────────────────────
async function queryAllStarCounts(
  qidsBySport: Map<string, string[]>
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const [sport, qids] of qidsBySport.entries()) {
    const instanceQid = ALL_STAR_INSTANCE_QID[sport];
    if (!instanceQid || !qids.length) continue;
    await sleep(1500);
    const ids = qids.map((q) => `wd:${q}`).join(" ");
    const q = `
SELECT ?entity (COUNT(DISTINCT ?award) AS ?cnt) WHERE {
  VALUES ?entity { ${ids} }
  ?entity wdt:P166 ?award .
  ?award wdt:P31 wd:${instanceQid} .
}
GROUP BY ?entity`;
    const rows = await sparql(q, `allstars-${sport}`);
    for (const r of rows) {
      const qid = r.entity?.value?.split("/").pop() ?? "";
      const cnt = parseInt(r.cnt?.value ?? "0", 10);
      if (qid && cnt > 0) counts.set(qid, cnt);
    }
    console.log(`  AllStars ${sport}: ${rows.length} athletes found with selections`);
  }
  return counts;
}

// ── Parse Wikidata time value to year ─────────────────────────────────────────
function parseYear(timeStr: string | undefined): number | null {
  if (!timeStr) return null;
  const m = timeStr.match(/([+-]?\d+)-\d{2}-\d{2}T/);
  return m ? parseInt(m[1], 10) : null;
}

// ── Pick best team QID from P54 statements ────────────────────────────────────
function pickBestTeamQid(p54Stmts: any[]): string | null {
  if (!p54Stmts?.length) return null;
  const active: Array<{ qid: string; start: number }> = [];
  const past: Array<{ qid: string; start: number; duration: number }> = [];

  for (const stmt of p54Stmts) {
    const qid: string | undefined = stmt.mainsnak?.datavalue?.value?.id;
    if (!qid) continue;
    const quals = stmt.qualifiers ?? {};
    const start = parseYear(quals.P580?.[0]?.datavalue?.value?.time) ?? 0;
    const end = parseYear(quals.P582?.[0]?.datavalue?.value?.time);
    if (!end) {
      active.push({ qid, start });
    } else {
      past.push({ qid, start, duration: end - start });
    }
  }

  if (active.length) {
    active.sort((a, b) => b.start - a.start);
    return active[0].qid;
  }
  if (past.length) {
    past.sort((a, b) => b.duration - a.duration);
    return past[0].qid;
  }
  return null;
}

// ── Compute yearsActive from P2031 + P2032 ────────────────────────────────────
function computeYearsActive(p2031: any[], p2032: any[], birthYear: number): number {
  const starts = (p2031 ?? [])
    .map((s: any) => parseYear(s.mainsnak?.datavalue?.value?.time))
    .filter((y): y is number => y !== null);
  const ends = (p2032 ?? [])
    .map((s: any) => parseYear(s.mainsnak?.datavalue?.value?.time))
    .filter((y): y is number => y !== null);

  const careerStart = starts.length ? Math.min(...starts) : birthYear + 22;
  const careerEnd = ends.length ? Math.max(...ends) : CURRENT_YEAR;
  const years = Math.max(1, Math.min(careerEnd, CURRENT_YEAR) - careerStart);
  return years > 40 ? 20 : years;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const athletes = await prisma.athlete.findMany({
    select: { id: true, name: true, sport: true, team: true, yearsActive: true, allStarSelections: true, birthYear: true },
    orderBy: { id: "asc" },
  });
  console.log(`\nFixing ${athletes.length} athletes\n`);

  // Step 1: QID lookup via SPARQL
  console.log("Step 1/4: SPARQL QID lookup…");
  const qidMap = await lookupQids(athletes.map((a) => a.name));
  console.log(`  Found ${qidMap.size}/${athletes.length} QIDs\n`);

  if (!qidMap.size) {
    console.error("No QIDs found — aborting");
    await prisma.$disconnect();
    return;
  }

  // Step 2: Batch claims fetch
  console.log("Step 2/4: Fetching entity claims…");
  const allQids = [...qidMap.values()];
  const claimsMap = await batchGetClaims(allQids);
  console.log(`  Got claims for ${claimsMap.size} entities\n`);

  // Step 3: Collect unique team QIDs and resolve labels
  console.log("Step 3/4: Resolving team labels…");
  const teamQidSet = new Set<string>();
  for (const claims of claimsMap.values()) {
    for (const stmt of (claims.P54 ?? [])) {
      const tqid: string | undefined = stmt.mainsnak?.datavalue?.value?.id;
      if (tqid) teamQidSet.add(tqid);
    }
  }
  console.log(`  ${teamQidSet.size} unique team QIDs to resolve`);
  const teamLabels = await batchGetLabels([...teamQidSet]);
  console.log(`  Resolved ${teamLabels.size} team labels\n`);

  // Step 4: SPARQL All-Star counts per sport
  console.log("Step 4/4: Counting All-Star / Pro Bowl selections…");
  const qidsBySport = new Map<string, string[]>();
  for (const a of athletes) {
    const qid = qidMap.get(a.name);
    if (!qid) continue;
    const list = qidsBySport.get(a.sport) ?? [];
    list.push(qid);
    qidsBySport.set(a.sport, list);
  }
  const allStarCounts = await queryAllStarCounts(qidsBySport);
  console.log();

  // Apply updates
  let fixed = 0;
  let unchanged = 0;
  let noQid = 0;

  for (const athlete of athletes) {
    const qid = qidMap.get(athlete.name);
    if (!qid) { noQid++; continue; }
    const claims = claimsMap.get(qid);
    if (!claims) { noQid++; continue; }

    const teamQid = pickBestTeamQid(claims.P54 ?? []);
    const newTeam = teamQid ? (teamLabels.get(teamQid) ?? athlete.team) : athlete.team;
    const newYearsActive = computeYearsActive(claims.P2031 ?? [], claims.P2032 ?? [], athlete.birthYear);
    const newAllStars = allStarCounts.get(qid) ?? athlete.allStarSelections;

    const teamChanged = newTeam !== athlete.team;
    const yearsChanged = newYearsActive !== athlete.yearsActive;
    const allStarsChanged = newAllStars !== athlete.allStarSelections;

    if (teamChanged || yearsChanged || allStarsChanged) {
      await prisma.athlete.update({
        where: { id: athlete.id },
        data: { team: newTeam, yearsActive: newYearsActive, allStarSelections: newAllStars },
      });
      fixed++;
      const changes: string[] = [];
      if (teamChanged) changes.push(`team: "${athlete.team}" → "${newTeam}"`);
      if (yearsChanged) changes.push(`yearsActive: ${athlete.yearsActive} → ${newYearsActive}`);
      if (allStarsChanged) changes.push(`allStars: ${athlete.allStarSelections} → ${newAllStars}`);
      console.log(`FIXED ${athlete.name}: ${changes.join(", ")}`);
    } else {
      unchanged++;
    }
  }

  console.log(`\n✓ Done — Fixed: ${fixed}, Unchanged: ${unchanged}, No QID: ${noQid}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
