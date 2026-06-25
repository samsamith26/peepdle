/**
 * Two-pass cleanup after fixAthleteData.ts:
 *
 *   Pass 1 — College/amateur team reset:
 *     Teams ending in " football", " basketball", " baseball", " hockey",
 *     or other college patterns get reset to "Unknown" so at least no wrong
 *     college team name pollutes the game.
 *
 *   Pass 2 — Better pro-team SPARQL:
 *     For athletes still showing "Unknown", run a SPARQL that filters P54 to
 *     teams with P118 (league) matching a known professional league.
 *
 *   Pass 3 — Manual patches for known-wrong specific athletes.
 *
 * Run:  npx tsx scripts/fixAthleteTeams.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

const UA = "celebridle-teamfix/1.0 (samuel.smith2204@gmail.com)";
const SPARQL_EP = "https://query.wikidata.org/sparql";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── SPARQL helper ─────────────────────────────────────────────────────────────
async function sparql(query: string, tag = "q"): Promise<any[]> {
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

// Wikidata QIDs for major professional sports leagues (P118 property values)
// NBA=Q155223, NFL=Q27972, MLB=Q1108547, NHL=Q11087
const SPORT_LEAGUE_QIDS: Record<string, string[]> = {
  NBA: ["Q155223", "Q19535418"],  // NBA + G League (for context)
  NFL: ["Q27972"],
  MLB: ["Q1108547"],
  NHL: ["Q11087"],
};

// ── Manual patches for specific known-wrong athletes ──────────────────────────
// These are athletes whose team cannot be reliably auto-fixed.
const MANUAL_PATCHES: Record<string, string> = {
  "Kristaps Porzingis": "Boston Celtics",
  "Aqib Talib": "Denver Broncos",
  "Jim Brown": "Cleveland Browns",
  "Dan Marino": "Miami Dolphins",
  "Troy Aikman": "Dallas Cowboys",
  "Adrian Peterson": "Minnesota Vikings",
  "Marshawn Lynch": "Seattle Seahawks",
  "Larry Bird": "Boston Celtics",
  "Scottie Pippen": "Chicago Bulls",
  "Troy Polamalu": "Pittsburgh Steelers",
  "Jalen Hurts": "Philadelphia Eagles",
  "Leonard Fournette": "Tampa Bay Buccaneers",
  "Heath Miller": "Pittsburgh Steelers",
  "Warren Sapp": "Tampa Bay Buccaneers",
  "Amari Cooper": "Cleveland Browns",
  "Steve McNair": "Tennessee Titans",
  "Jaylen Waddle": "Miami Dolphins",
  "Derrick Brooks": "Tampa Bay Buccaneers",
  "Patrick Willis": "San Francisco 49ers",
  "Bob Lilly": "Dallas Cowboys",
  "Randy White": "Dallas Cowboys",
  "Dominique Wilkins": "Atlanta Hawks",
  "Bob Cousy": "Boston Celtics",
  "Joe Thomas": "Cleveland Browns",
  "Franz Wagner": "Orlando Magic",
  "Elgin Baylor": "Los Angeles Lakers",
  "Reggie Jackson": "Oakland Athletics",
  "Frank Robinson": "Cincinnati Reds",
  "Jim Palmer": "Baltimore Orioles",
  "Nick Van Exel": "Los Angeles Lakers",
  "Jackie Robinson": "Brooklyn Dodgers",
  "Randy Johnson": "Seattle Mariners",
  "Ted Williams": "Boston Red Sox",
  "Manny Ramirez": "Cleveland Indians",
  "Ken Anderson": "Cincinnati Bengals",
  "George Gervin": "San Antonio Spurs",
  "Nate Archibald": "Kansas City Kings",
  "Rick Barry": "Golden State Warriors",
  "Dave Cowens": "Boston Celtics",
  "Dave Bing": "Detroit Pistons",
  "Bob McAdoo": "New York Knicks",
  "Artis Gilmore": "Chicago Bulls",
  "Julius Erving": "Philadelphia 76ers",
  "Moses Malone": "Houston Rockets",
  "David Robinson": "San Antonio Spurs",
  "Manu Ginóbili": "San Antonio Spurs",
  "Pau Gasol": "Los Angeles Lakers",
  "Detlef Schrempf": "Indiana Pacers",
  "Dominic Wilkins": "Atlanta Hawks",
  "Stephon Marbury": "New York Knicks",
  "Shareef Abdur-Rahim": "Atlanta Hawks",
  "Wilt Chamberlain": "Philadelphia 76ers",
  "Oscar Robertson": "Milwaukee Bucks",
};

// ── Pass 1: Reset college/amateur team strings to Unknown ─────────────────────
async function resetCollegeTeams() {
  // College/amateur patterns that appear at end of team name
  const patterns = [
    " football",
    " basketball",
    " baseball",
    " hockey",
    " men's basketball",
    " women's basketball",
    " men's football",
    "F.C.",         // soccer clubs polluting non-soccer athletes
  ];

  const athletes = await prisma.athlete.findMany({
    select: { id: true, name: true, sport: true, team: true },
  });

  let resetCount = 0;
  for (const a of athletes) {
    const lowerTeam = a.team.toLowerCase();
    const isCollegePattern = patterns.some((p) => a.team.endsWith(p) || a.team.endsWith(p.toLowerCase()));
    // Also catch things like "Dumbarton F.C." for non-soccer athletes
    const hasFCForNonSoccer = a.team.includes("F.C.") || a.team.includes(" FC ");

    if (isCollegePattern || hasFCForNonSoccer) {
      await prisma.athlete.update({ where: { id: a.id }, data: { team: "Unknown" } });
      console.log(`  RESET ${a.name}: "${a.team}" → "Unknown"`);
      resetCount++;
    }
  }
  console.log(`  Reset ${resetCount} college/amateur teams to Unknown\n`);
}

// ── Pass 2: SPARQL pro-team query for Unknown athletes ────────────────────────
async function fixUnknownTeams() {
  const unknownAthletes = await prisma.athlete.findMany({
    where: { team: { in: ["Unknown", ""] } },
    select: { id: true, name: true, sport: true, birthYear: true },
  });

  if (!unknownAthletes.length) {
    console.log("  No Unknown teams to fix.\n");
    return;
  }

  console.log(`  ${unknownAthletes.length} athletes with Unknown team\n`);

  // Group by sport, then run SPARQL to get QIDs and pro team
  for (const [sport, leagueQids] of Object.entries(SPORT_LEAGUE_QIDS)) {
    const sportAthletes = unknownAthletes.filter((a) => a.sport === sport);
    if (!sportAthletes.length) continue;

    const CHUNK = 50;
    for (let i = 0; i < sportAthletes.length; i += CHUNK) {
      const chunk = sportAthletes.slice(i, i + CHUNK);
      const nameList = chunk.map((a) => `"${a.name.replace(/"/g, '\\"')}"@en`).join(" ");
      const leagueFilter = leagueQids.map((q) => `wd:${q}`).join(", ");

      // Find entity + latest pro team (no end date, correct league)
      const q = `
SELECT DISTINCT ?name ?teamLabel WHERE {
  VALUES ?name { ${nameList} }
  ?entity rdfs:label ?name . FILTER(LANG(?name) = "en")
  ?entity wdt:P569 ?birth .
  ?entity p:P54 ?stmt .
  ?stmt ps:P54 ?team .
  ?team wdt:P118 ?league .
  FILTER(?league IN (${leagueFilter}))
  ?team rdfs:label ?teamLabel . FILTER(LANG(?teamLabel) = "en")
  OPTIONAL { ?stmt pq:P582 ?endDate }
  FILTER(!BOUND(?endDate))
}`;
      await sleep(1500);
      const rows = await sparql(q, `pro-${sport}-${i}`);

      const teamByName = new Map<string, string>();
      for (const r of rows) {
        const name: string = r.name?.value ?? "";
        const teamLabel: string = r.teamLabel?.value ?? "";
        if (name && teamLabel && !teamByName.has(name)) teamByName.set(name, teamLabel);
      }

      for (const a of chunk) {
        const team = teamByName.get(a.name);
        if (team) {
          await prisma.athlete.update({ where: { id: a.id }, data: { team } });
          console.log(`  FIXED ${a.name}: Unknown → "${team}"`);
        }
      }
    }
  }
}

// ── Pass 3: Manual patches ─────────────────────────────────────────────────────
async function applyManualPatches() {
  let count = 0;
  for (const [name, team] of Object.entries(MANUAL_PATCHES)) {
    const athlete = await prisma.athlete.findFirst({ where: { name } });
    if (!athlete) continue;
    if (athlete.team === team) continue; // already correct
    await prisma.athlete.update({ where: { id: athlete.id }, data: { team } });
    console.log(`  MANUAL ${name}: "${athlete.team}" → "${team}"`);
    count++;
  }
  console.log(`  Applied ${count} manual patches\n`);
}

// ── Pass 4: Fix allStarSelections ────────────────────────────────────────────
// Correct QIDs (from Wikidata search):
//   NBA All-Star Game  = Q137341
//   Pro Bowl (NFL)     = Q786705
//   MLB All-Star Game  = Q1069698
//   NHL All-Star Game  = Q29144
//
// Approach: Look for P166 awards that are instances (P31) of the sport's
// All-Star game concept.  Wikidata tracks individual yearly events as
// "2003 NBA All-Star Game" with P31=Q137341, and some athletes have P166
// pointing to those specific events.
async function fixAllStarSelections() {
  const athletes = await prisma.athlete.findMany({
    where: { allStarSelections: 0 },
    select: { id: true, name: true, sport: true },
  });

  const SPORTS_GAME_QID: Record<string, string> = {
    NBA: "Q137341",
    NFL: "Q786705",
    MLB: "Q1069698",
    NHL: "Q29144",
  };

  const CHUNK = 40;
  const OCCUPATIONS = "wd:Q2066131 wd:Q3665646 wd:Q628099 wd:Q13141064 wd:Q19204627";

  for (const [sport, gameQid] of Object.entries(SPORTS_GAME_QID)) {
    const sportAthletes = athletes.filter((a) => a.sport === sport);
    if (!sportAthletes.length) continue;
    console.log(`  ${sport}: checking ${sportAthletes.length} athletes…`);

    for (let i = 0; i < sportAthletes.length; i += CHUNK) {
      const chunk = sportAthletes.slice(i, i + CHUNK);
      const nameList = chunk.map((a) => `"${a.name.replace(/"/g, '\\"')}"@en`).join(" ");

      // Count P166 awards that are instances of the sport's All-Star game
      const q = `
SELECT ?name (COUNT(DISTINCT ?award) AS ?cnt) WHERE {
  VALUES ?name { ${nameList} }
  ?entity rdfs:label ?name . FILTER(LANG(?name) = "en")
  ?entity wdt:P569 ?birth .
  ?entity wdt:P106 ?occ . VALUES ?occ { ${OCCUPATIONS} }
  ?entity wdt:P166 ?award .
  ?award wdt:P31 wd:${gameQid} .
}
GROUP BY ?name`;

      await sleep(2000);
      const rows = await sparql(q, `allstar-${sport}-${i}`);

      const countByName = new Map<string, number>();
      for (const r of rows) {
        const name: string = r.name?.value ?? "";
        const cnt = parseInt(r.cnt?.value ?? "0", 10);
        if (name && cnt > 0) countByName.set(name, cnt);
      }

      for (const a of chunk) {
        const cnt = countByName.get(a.name);
        if (cnt && cnt > 0) {
          await prisma.athlete.update({ where: { id: a.id }, data: { allStarSelections: cnt } });
          console.log(`  ALLSTAR ${a.name} (${sport}): 0 → ${cnt}`);
        }
      }
    }
  }
}

async function main() {
  console.log("\n=== Pass 1: Reset college/amateur teams ===");
  await resetCollegeTeams();

  console.log("=== Pass 2: SPARQL pro-team fix for Unknown ===");
  await fixUnknownTeams();

  console.log("\n=== Pass 3: Manual patches ===");
  await applyManualPatches();

  console.log("=== Pass 4: Fix allStarSelections ===");
  await fixAllStarSelections();

  console.log("\n✓ All passes complete");
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
