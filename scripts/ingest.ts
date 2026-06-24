/**
 * Bulk Wikidata ingestion for Actordle + Athletedle.
 *
 * Fetches ~600 actor candidates and ~600 athlete candidates from Wikidata,
 * resolves images (Wikidata P18 → Commons CDN), and upserts to the database.
 * Prints a final report showing how many were successfully inserted with
 * complete data for each pool.
 *
 * Usage:
 *   npx tsx scripts/ingest.ts [--actors-only | --athletes-only]
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ── Config ────────────────────────────────────────────────────────────────────

const SPARQL_EP = "https://query.wikidata.org/sparql";
const COMMONS_EP = "https://commons.wikimedia.org/w/api.php";
const UA = "celebridle-ingest/1.0 (samuel.smith2204@gmail.com)";
const THUMB_W = 300;
const SPARQL_DELAY = 1500; // ms between SPARQL queries (stay within rate limits)
const CURRENT_YEAR = new Date().getFullYear();

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const args = process.argv.slice(2);
const ACTORS_ONLY = args.includes("--actors-only");
const ATHLETES_ONLY = args.includes("--athletes-only");

// ── SPARQL helper ─────────────────────────────────────────────────────────────

async function sparqlQuery(query: string, label = ""): Promise<any[]> {
  await sleep(SPARQL_DELAY);
  const url = `${SPARQL_EP}?query=${encodeURIComponent(query.trim())}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`  SPARQL ${res.status}${label ? ` [${label}]` : ""}: ${text.slice(0, 120)}`);
      return [];
    }
    const data: any = await res.json();
    return data.results?.bindings ?? [];
  } catch (e: any) {
    console.warn(`  SPARQL error${label ? ` [${label}]` : ""}: ${e.message?.slice(0, 100)}`);
    return [];
  }
}

// ── Filename extraction from Wikidata P18 URL ─────────────────────────────────
// Wikidata P18 values look like: http://commons.wikimedia.org/wiki/Special:FilePath/Tom_Hanks.jpg

function p18ToFilename(url: string): string | null {
  const m = url.match(/Special:FilePath\/(.+)$/);
  return m ? decodeURIComponent(m[1]).replace(/ /g, "_") : null;
}

// ── Commons imageinfo batch ───────────────────────────────────────────────────
// Converts Commons filenames → direct CDN thumbnail URLs (no redirect chains).

async function batchThumbUrls(filenames: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const BATCH = 50;

  for (let i = 0; i < filenames.length; i += BATCH) {
    await sleep(300);
    const batch = filenames.slice(i, i + BATCH);
    const titles = batch.map((f) => `File:${f.replace(/_/g, " ")}`).join("|");
    const url =
      `${COMMONS_EP}?action=query&titles=${encodeURIComponent(titles)}` +
      `&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_W}&format=json`;
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const data: any = await res.json();
      for (const page of Object.values(data.query?.pages ?? {}) as any[]) {
        const thumb: string | undefined = page?.imageinfo?.[0]?.thumburl;
        const title: string = page?.title ?? "";
        if (thumb && title.startsWith("File:")) {
          result.set(title.slice("File:".length).replace(/ /g, "_"), thumb);
        }
      }
    } catch { /* skip batch on error */ }
  }
  return result;
}

// ── Wikidata P18 by name (used for actor collabs/directors where QID unknown) ─

async function sparqlP18ByName(names: string[]): Promise<Map<string, string>> {
  if (!names.length) return new Map();
  const valuesList = names.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join(" ");
  const q = `
SELECT ?name (SAMPLE(?image) AS ?img) WHERE {
  VALUES ?name { ${valuesList} }
  ?entity rdfs:label ?name .
  ?entity wdt:P18 ?image .
  FILTER(LANG(?name) = "en")
}
GROUP BY ?name`;

  const rows = await sparqlQuery(q, "P18 by name");
  const result = new Map<string, string>();
  for (const r of rows) {
    const name: string = r.name?.value;
    const imgUrl: string = r.img?.value ?? "";
    const filename = p18ToFilename(imgUrl);
    if (name && filename) result.set(name, filename);
  }
  return result;
}

// ── Athletes ──────────────────────────────────────────────────────────────────

interface RawAthlete {
  name: string;
  sport: string;
  birthYear: number;
  team: string;
  position: string;
  heightCm: number;
  yearsActive: number;
  imageFilename: string | null;
}

// Maps Wikidata sport/occupation QIDs to the game's display league label.
// Using TWO queries per sport:
//   1. P641 (sport) with the sport QID  — primary
//   2. P641 alternative or broad label   — fallback (for ice hockey via P106)
const SPORT_CONFIGS: Array<{
  display: string;
  queries: string[];
}> = [
  {
    display: "NBA",
    queries: [`
SELECT DISTINCT ?ath ?name ?birth ?image WHERE {
  ?ath wdt:P641 wd:Q5372 .
  ?ath wdt:P569 ?birth .
  ?ath rdfs:label ?name . FILTER(LANG(?name) = "en")
  OPTIONAL { ?ath wdt:P18 ?image . }
}
ORDER BY ?ath LIMIT 200`],
  },
  {
    display: "NFL",
    queries: [`
SELECT DISTINCT ?ath ?name ?birth ?image WHERE {
  ?ath wdt:P641 wd:Q41323 .
  ?ath wdt:P569 ?birth .
  ?ath rdfs:label ?name . FILTER(LANG(?name) = "en")
  OPTIONAL { ?ath wdt:P18 ?image . }
}
ORDER BY ?ath LIMIT 200`],
  },
  {
    display: "MLB",
    queries: [`
SELECT DISTINCT ?ath ?name ?birth ?image WHERE {
  ?ath wdt:P641 wd:Q5849 .
  ?ath wdt:P569 ?birth .
  ?ath rdfs:label ?name . FILTER(LANG(?name) = "en")
  OPTIONAL { ?ath wdt:P18 ?image . }
}
ORDER BY ?ath LIMIT 200`],
  },
  {
    display: "NHL",
    queries: [
      // ice hockey Q41328 — primary
      `SELECT DISTINCT ?ath ?name ?birth ?image WHERE {
  ?ath wdt:P641 wd:Q41328 .
  ?ath wdt:P569 ?birth .
  ?ath rdfs:label ?name . FILTER(LANG(?name) = "en")
  OPTIONAL { ?ath wdt:P18 ?image . }
}
ORDER BY ?ath LIMIT 200`,
      // ice hockey player occupation Q22279563 — fallback if P641 returns nothing
      `SELECT DISTINCT ?ath ?name ?birth ?image WHERE {
  ?ath wdt:P106 wd:Q22279563 .
  ?ath wdt:P569 ?birth .
  ?ath rdfs:label ?name . FILTER(LANG(?name) = "en")
  OPTIONAL { ?ath wdt:P18 ?image . }
}
ORDER BY ?ath LIMIT 200`,
    ],
  },
];

// Batch query for team + position + height for a set of QIDs.
async function fetchAthleteDetails(qids: string[]): Promise<Map<string, {
  team: string; position: string; heightCm: number; yearsActive: number;
}>> {
  const result = new Map<string, { team: string; position: string; heightCm: number; yearsActive: number }>();
  const BATCH = 50;

  for (let i = 0; i < qids.length; i += BATCH) {
    const batch = qids.slice(i, i + BATCH);
    const ids = batch.map((q) => `wd:${q}`).join(" ");
    const q = `
SELECT ?ath
  (SAMPLE(?teamLabel) AS ?team)
  (SAMPLE(?posLabel) AS ?pos)
  (SAMPLE(?height) AS ?heightVal)
  (SAMPLE(?ys) AS ?yearsStart) WHERE {
  VALUES ?ath { ${ids} }
  OPTIONAL {
    ?ath wdt:P54 ?t .
    ?t rdfs:label ?teamLabel . FILTER(LANG(?teamLabel) = "en")
  }
  OPTIONAL {
    ?ath wdt:P413 ?p .
    ?p rdfs:label ?posLabel . FILTER(LANG(?posLabel) = "en")
  }
  OPTIONAL { ?ath wdt:P2048 ?height . FILTER(?height > 100) }
  OPTIONAL { ?ath wdt:P2031 ?ys . }
}
GROUP BY ?ath`;

    const rows = await sparqlQuery(q, `details batch ${i / BATCH + 1}`);
    for (const row of rows) {
      const qid = row.ath?.value?.split("/").pop() ?? "";
      if (!qid) continue;
      const team = (row.team?.value ?? "").trim() || "Unknown";
      const position = (row.pos?.value ?? "").trim() || "Unknown";
      const heightCm = Math.round(parseFloat(row.heightVal?.value ?? "0"));
      const yearsFrom = row.yearsStart?.value ? new Date(row.yearsStart.value).getFullYear() : 0;
      const yearsActive = yearsFrom ? Math.max(1, CURRENT_YEAR - yearsFrom) : 1;
      result.set(qid, { team, position, heightCm, yearsActive });
    }
    process.stdout.write(`    details ${Math.min(i + BATCH, qids.length)}/${qids.length}\r`);
  }
  console.log();
  return result;
}

async function fetchAthletes(): Promise<RawAthlete[]> {
  const athletes: RawAthlete[] = [];
  const seenQids = new Set<string>();

  for (const { display, queries } of SPORT_CONFIGS) {
    let rows: any[] = [];

    for (const q of queries) {
      console.log(`  Querying ${display}…`);
      rows = await sparqlQuery(q, display);
      console.log(`  ${display}: ${rows.length} raw rows`);
      if (rows.length > 0) break; // first query succeeded
    }

    const sportCandidates: Array<{ qid: string; name: string; birthYear: number; imageFilename: string | null }> = [];

    for (const row of rows) {
      const qid: string = row.ath?.value?.split("/").pop() ?? "";
      if (!qid || seenQids.has(qid)) continue;
      seenQids.add(qid);

      const name = (row.name?.value ?? "").trim();
      const birthIso = row.birth?.value ?? "";
      const birthYear = birthIso ? new Date(birthIso).getFullYear() : 0;
      if (!name || !birthYear) continue;

      const imgUrl = row.image?.value ?? "";
      const imageFilename = imgUrl ? p18ToFilename(imgUrl) : null;

      sportCandidates.push({ qid, name, birthYear, imageFilename });
    }

    console.log(`  ${display}: ${sportCandidates.length} candidates with name+birth`);

    // Batch-fetch team/position/height/yearsActive for all candidates
    const qids = sportCandidates.map((c) => c.qid);
    const detailMap = await fetchAthleteDetails(qids);

    for (const { qid, name, birthYear, imageFilename } of sportCandidates) {
      const det = detailMap.get(qid) ?? { team: "Unknown", position: "Unknown", heightCm: 0, yearsActive: 1 };
      athletes.push({
        name, sport: display, birthYear,
        team: det.team, position: det.position, heightCm: det.heightCm, yearsActive: det.yearsActive,
        imageFilename,
      });
    }
  }
  return athletes;
}

async function ingestAthletes(): Promise<{ total: number; inserted: number }> {
  console.log("\n═══ Athletes ════════════════════════════════════════");
  const candidates = await fetchAthletes();
  console.log(`Candidates with name+birth: ${candidates.length}`);

  // Resolve images: extract filenames we already have from SPARQL + batch Commons
  const filenames = [...new Set(candidates.map((a) => a.imageFilename).filter(Boolean) as string[])];
  console.log(`  Fetching ${filenames.length} Commons thumbnails…`);
  const thumbMap = await batchThumbUrls(filenames);
  console.log(`  ${thumbMap.size} thumbnails resolved`);

  let inserted = 0;

  for (const a of candidates) {
    const imageUrl = a.imageFilename ? (thumbMap.get(a.imageFilename) ?? null) : null;
    try {
      await prisma.athlete.upsert({
        where: { name: a.name },
        update: {
          birthYear: a.birthYear, sport: a.sport, team: a.team,
          position: a.position, heightCm: a.heightCm, yearsActive: a.yearsActive,
          allStarSelections: 0, imageUrl,
        },
        create: {
          name: a.name, birthYear: a.birthYear, sport: a.sport, team: a.team,
          position: a.position, heightCm: a.heightCm, yearsActive: a.yearsActive,
          allStarSelections: 0, imageUrl,
        },
      });
      inserted++;
    } catch (e: any) {
      if (!e.message?.includes("Unique constraint")) {
        console.warn(`  skip ${a.name}: ${e.message?.slice(0, 80)}`);
      }
    }
  }
  return { total: candidates.length, inserted };
}

// ── Actors ────────────────────────────────────────────────────────────────────

interface RawActor {
  qid: string;
  name: string;
  birthYear: number;
  nationality: string;
  yearsActive: number;
  genres: string[];
  numberOfFilms: number;
  majorAwards: number;
  totalCareerGross: bigint;
  avgCriticScore: number;
  imageFilename: string | null;
  collabNames: string[];
  directorName: string;
}

async function fetchActorCandidates(): Promise<RawActor[]> {
  console.log("  Querying actor basic info (2 pages × 300)…");
  const actorMap = new Map<string, RawActor>();

  for (const offset of [0, 300]) {
    const q = `
SELECT DISTINCT ?actor ?birth ?natLabel ?yearsStart ?image
  (SAMPLE(?name) AS ?actorName)
  (GROUP_CONCAT(DISTINCT ?gl; SEPARATOR="|") AS ?genres)
  (COUNT(DISTINCT ?film) AS ?numFilms)
  (COUNT(DISTINCT ?award) AS ?numAwards)
WHERE {
  ?actor wdt:P106 wd:Q33999 .
  ?actor wdt:P569 ?birth .
  ?actor wdt:P27 ?nat .
  ?actor rdfs:label ?name . FILTER(LANG(?name) = "en")
  ?nat rdfs:label ?natLabel . FILTER(LANG(?natLabel) = "en")
  ?film wdt:P161 ?actor .
  OPTIONAL { ?film wdt:P136 ?genre . ?genre rdfs:label ?gl . FILTER(LANG(?gl) = "en") }
  OPTIONAL { ?actor wdt:P166 ?award . }
  OPTIONAL { ?actor wdt:P2031 ?yearsStart . }
  OPTIONAL { ?actor wdt:P18 ?image . }
  FILTER(YEAR(?birth) > 1900)
}
GROUP BY ?actor ?birth ?natLabel ?yearsStart ?image
HAVING (COUNT(DISTINCT ?film) >= 5)
ORDER BY DESC(COUNT(DISTINCT ?film))
LIMIT 300
OFFSET ${offset}`;

    const rows = await sparqlQuery(q, `actors offset=${offset}`);
    console.log(`  offset ${offset}: ${rows.length} rows`);

    for (const row of rows) {
      const qid: string = row.actor?.value?.split("/").pop() ?? "";
      if (!qid || actorMap.has(qid)) continue;

      const name = (row.actorName?.value ?? "").trim();
      const birthIso = row.birth?.value ?? "";
      const birthYear = birthIso ? new Date(birthIso).getFullYear() : 0;
      const nationality = (row.natLabel?.value ?? "").trim();
      const genreRaw = row.genres?.value ?? "";
      const genreParts: string[] = genreRaw.split("|").map((g: string) => g.trim()).filter((g: string) => Boolean(g)).slice(0, 5);
      const genres: string[] = [...new Set(genreParts)];
      const numFilms = parseInt(row.numFilms?.value ?? "0", 10);
      const majorAwards = parseInt(row.numAwards?.value ?? "0", 10);
      const yearsFrom = row.yearsStart?.value
        ? new Date(row.yearsStart.value).getFullYear()
        : Math.max(1950, birthYear + 22);
      const yearsActive = Math.max(1, CURRENT_YEAR - yearsFrom);
      const imgUrl = row.image?.value ?? "";
      const imageFilename = imgUrl ? p18ToFilename(imgUrl) : null;

      if (!name || !birthYear || !nationality || !genres.length) continue;

      actorMap.set(qid, {
        qid, name, birthYear, nationality, yearsActive,
        genres, numberOfFilms: numFilms, majorAwards,
        totalCareerGross: BigInt(0), avgCriticScore: 0,
        imageFilename, collabNames: [], directorName: "",
      });
    }
  }
  return [...actorMap.values()];
}

async function fetchActorCareerGross(actors: RawActor[]): Promise<void> {
  console.log(`  Fetching career gross (P2142 sum) for ${actors.length} actors…`);
  const BATCH = 40;
  for (let i = 0; i < actors.length; i += BATCH) {
    const batch = actors.slice(i, i + BATCH);
    const ids = batch.map((a) => `wd:${a.qid}`).join(" ");
    const q = `
SELECT ?actor (SUM(?gross) AS ?total) WHERE {
  VALUES ?actor { ${ids} }
  ?film wdt:P161 ?actor .
  ?film wdt:P2142 ?gross .
}
GROUP BY ?actor`;
    const rows = await sparqlQuery(q, `gross batch ${i / BATCH + 1}`);
    for (const row of rows) {
      const qid = row.actor?.value?.split("/").pop();
      const total = parseInt(row.total?.value ?? "0", 10);
      const actor = batch.find((a) => a.qid === qid);
      if (actor && total > 0) actor.totalCareerGross = BigInt(total);
    }
    process.stdout.write(`    ${Math.min(i + BATCH, actors.length)}/${actors.length}\r`);
  }
  console.log();
}

async function fetchActorCollabsAndDirectors(actors: RawActor[]): Promise<void> {
  console.log(`  Fetching collaborators & directors for ${actors.length} actors…`);
  const BATCH = 20;

  for (let i = 0; i < actors.length; i += BATCH) {
    const batch = actors.slice(i, i + BATCH);
    const ids = batch.map((a) => `wd:${a.qid}`).join(" ");

    const collabQ = `
SELECT ?actor ?coname (COUNT(?film) AS ?c) WHERE {
  VALUES ?actor { ${ids} }
  ?film wdt:P161 ?actor .
  ?film wdt:P161 ?coactor .
  FILTER(?coactor != ?actor)
  ?coactor rdfs:label ?coname . FILTER(LANG(?coname) = "en")
}
GROUP BY ?actor ?coname
ORDER BY ?actor DESC(?c)
LIMIT 300`;

    const dirQ = `
SELECT ?actor ?dirname (COUNT(?film) AS ?c) WHERE {
  VALUES ?actor { ${ids} }
  ?film wdt:P161 ?actor .
  ?film wdt:P57 ?dir .
  ?dir rdfs:label ?dirname . FILTER(LANG(?dirname) = "en")
}
GROUP BY ?actor ?dirname
ORDER BY ?actor DESC(?c)
LIMIT 100`;

    const [collabRows, dirRows] = await Promise.all([
      sparqlQuery(collabQ, `collabs batch ${i / BATCH + 1}`),
      sparqlQuery(dirQ, `dirs batch ${i / BATCH + 1}`),
    ]);
    await sleep(SPARQL_DELAY); // extra wait after double-query

    const collabMap = new Map<string, string[]>();
    for (const row of collabRows) {
      const qid = row.actor?.value?.split("/").pop() ?? "";
      const cname = (row.coname?.value ?? "").trim();
      if (!qid || !cname) continue;
      if (!collabMap.has(qid)) collabMap.set(qid, []);
      const arr = collabMap.get(qid)!;
      if (arr.length < 3) arr.push(cname);
    }

    const dirMap = new Map<string, string>();
    for (const row of dirRows) {
      const qid = row.actor?.value?.split("/").pop() ?? "";
      const dname = (row.dirname?.value ?? "").trim();
      if (!qid || !dname || dirMap.has(qid)) continue;
      dirMap.set(qid, dname);
    }

    for (const actor of batch) {
      actor.collabNames = collabMap.get(actor.qid) ?? [];
      actor.directorName = dirMap.get(actor.qid) ?? "";
    }

    process.stdout.write(`    ${Math.min(i + BATCH, actors.length)}/${actors.length}\r`);
  }
  console.log();
}

async function ingestActors(): Promise<{ total: number; inserted: number; skippedNoCollab: number }> {
  console.log("\n═══ Actors ══════════════════════════════════════════");
  const candidates = await fetchActorCandidates();
  console.log(`Candidates with name+birth+nationality+genres: ${candidates.length}`);

  await fetchActorCareerGross(candidates);
  await fetchActorCollabsAndDirectors(candidates);

  // Resolve images: for actors we already have filenames from SPARQL.
  // For collabs/directors we only have names, so use P18 by name.
  const actorFilenames = [...new Set(
    candidates.map((a) => a.imageFilename).filter(Boolean) as string[]
  )];

  const collabNames = [...new Set(
    candidates.flatMap((a) => [...a.collabNames, a.directorName]).filter(Boolean)
  )];
  console.log(`  Resolving images for ${collabNames.length} collab/director names (P18 by name)…`);

  // Batch P18 by name for collab/director names (chunks of 80)
  const collabFilenameMap = new Map<string, string>(); // name → filename
  const CHUNK = 80;
  for (let i = 0; i < collabNames.length; i += CHUNK) {
    const chunk = collabNames.slice(i, i + CHUNK);
    const chunkMap = await sparqlP18ByName(chunk);
    for (const [n, f] of chunkMap) collabFilenameMap.set(n, f);
    process.stdout.write(`    P18 chunk ${Math.floor(i / CHUNK) + 1}/${Math.ceil(collabNames.length / CHUNK)}\r`);
  }
  console.log();

  const collabFilenames = [...new Set(collabFilenameMap.values())];
  const allFilenames = [...new Set([...actorFilenames, ...collabFilenames])];
  console.log(`  Fetching ${allFilenames.length} Commons thumbnails…`);
  const thumbMap = await batchThumbUrls(allFilenames);
  console.log(`  ${thumbMap.size} thumbnails resolved`);

  const getThumb = (filename: string | null): string | null =>
    filename ? (thumbMap.get(filename) ?? null) : null;
  const getNameThumb = (name: string): string | null =>
    getThumb(collabFilenameMap.get(name) ?? null);

  let inserted = 0;
  let skippedNoCollab = 0;

  for (const a of candidates) {
    if (a.collabNames.length < 1 || !a.directorName) {
      skippedNoCollab++;
      continue;
    }

    const imageUrl = getThumb(a.imageFilename);
    const collaborators = a.collabNames.map((n) => ({ name: n, imageUrl: getNameThumb(n) }));
    const director = { name: a.directorName, imageUrl: getNameThumb(a.directorName) };

    try {
      const data = {
        name: a.name, birthYear: a.birthYear, nationality: a.nationality,
        yearsActive: a.yearsActive, genres: a.genres, numberOfFilms: a.numberOfFilms,
        majorAwards: a.majorAwards, totalCareerGross: a.totalCareerGross,
        avgCriticScore: a.avgCriticScore, imageUrl,
        collaborators: collaborators as any,
        director: director as any,
      };
      await prisma.actor.upsert({ where: { name: a.name }, update: data, create: data });
      inserted++;
    } catch (e: any) {
      if (!e.message?.includes("Unique constraint")) {
        console.warn(`  skip ${a.name}: ${e.message?.slice(0, 80)}`);
      }
    }
  }
  return { total: candidates.length, inserted, skippedNoCollab };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Starting bulk Wikidata ingestion…\n");

  let athleteResult: { total: number; inserted: number } | null = null;
  let actorResult: { total: number; inserted: number; skippedNoCollab: number } | null = null;

  if (!ATHLETES_ONLY) actorResult = await ingestActors();
  if (!ACTORS_ONLY) athleteResult = await ingestAthletes();

  console.log("\n═══ Final Report ════════════════════════════════════");
  if (actorResult) {
    const totalInDb = await prisma.actor.count();
    const withImages = await prisma.actor.count({ where: { imageUrl: { not: null } } });
    console.log("ACTORS");
    console.log(`  Candidates fetched:         ${actorResult.total}`);
    console.log(`  Skipped (no collab/dir):    ${actorResult.skippedNoCollab}`);
    console.log(`  Successfully inserted:      ${actorResult.inserted}`);
    console.log(`  Total actors in DB:         ${totalInDb}`);
    console.log(`  Actors with images:         ${withImages}`);
  }
  if (athleteResult) {
    const totalInDb = await prisma.athlete.count();
    const withImages = await prisma.athlete.count({ where: { imageUrl: { not: null } } });
    console.log("ATHLETES");
    console.log(`  Candidates fetched:         ${athleteResult.total}`);
    console.log(`  Successfully inserted:      ${athleteResult.inserted}`);
    console.log(`  Total athletes in DB:       ${totalInDb}`);
    console.log(`  Athletes with images:       ${withImages}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
