/**
 * Standalone script: fix allStarSelections for all athletes using correct Wikidata QIDs.
 *
 * Correct QIDs (verified 2026-06-24):
 *   NBA All-Star Game  = Q137341
 *   Pro Bowl (NFL)     = Q786705
 *   MLB All-Star Game  = Q1069698
 *   NHL All-Star Game  = Q29144
 *
 * Run: npx tsx scripts/fixAllStars.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const UA = "celebridle-allstars/1.0 (samuel.smith2204@gmail.com)";
const SPARQL_EP = "https://query.wikidata.org/sparql";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

const SPORTS_GAME_QID: Record<string, string> = {
  NBA: "Q137341",
  NFL: "Q786705",
  MLB: "Q1069698",
  NHL: "Q29144",
};

async function sparql(query: string, tag = "q"): Promise<any[]> {
  const url = `${SPARQL_EP}?query=${encodeURIComponent(query.trim())}&format=json`;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 10000);
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": UA, Accept: "application/sparql-results+json" },
      });
      if (res.status === 429 || res.status === 503) {
        console.warn(`  SPARQL [${tag}] ${res.status} — retry ${attempt + 1} in ${(attempt + 1) * 10}s`);
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

async function main() {
  const OCCUPATIONS = "wd:Q2066131 wd:Q3665646 wd:Q628099 wd:Q13141064 wd:Q19204627";
  const CHUNK = 40;

  const athletes = await prisma.athlete.findMany({
    select: { id: true, name: true, sport: true, allStarSelections: true },
    orderBy: { id: "asc" },
  });

  let totalFixed = 0;

  for (const [sport, gameQid] of Object.entries(SPORTS_GAME_QID)) {
    const sportAthletes = athletes.filter((a) => a.sport === sport);
    console.log(`\n${sport}: ${sportAthletes.length} athletes, game QID = wd:${gameQid}`);

    let sportFixed = 0;
    for (let i = 0; i < sportAthletes.length; i += CHUNK) {
      const chunk = sportAthletes.slice(i, i + CHUNK);
      const nameList = chunk.map((a) => `"${a.name.replace(/"/g, '\\"')}"@en`).join(" ");

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
      const rows = await sparql(q, `${sport}-${i}`);

      const countByName = new Map<string, number>();
      for (const r of rows) {
        const name: string = r.name?.value ?? "";
        const cnt = parseInt(r.cnt?.value ?? "0", 10);
        if (name && cnt > 0) countByName.set(name, cnt);
      }

      for (const a of chunk) {
        const cnt = countByName.get(a.name) ?? 0;
        if (cnt !== a.allStarSelections) {
          await prisma.athlete.update({ where: { id: a.id }, data: { allStarSelections: cnt } });
          console.log(`  FIXED ${a.name}: ${a.allStarSelections} → ${cnt}`);
          totalFixed++;
          sportFixed++;
        }
      }

      process.stdout.write(`  Processed ${Math.min(i + CHUNK, sportAthletes.length)}/${sportAthletes.length}\r`);
    }
    console.log(`  Done — ${sportFixed} athletes updated`);
  }

  console.log(`\n✓ Total fixed: ${totalFixed}`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
