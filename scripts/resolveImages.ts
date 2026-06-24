/**
 * Resolves imageUrls using Wikidata SPARQL + Wikimedia Commons imageinfo API.
 *
 * Strategy (avoids per-person rate-limiting):
 *   1. ONE SPARQL query to Wikidata to get P18 image filenames for all names at once.
 *   2. Batched Commons imageinfo API calls (up to 50 files per request) to convert
 *      filenames to direct upload.wikimedia.org CDN thumbnails.
 *   3. TMDb fallback for actors/directors/collaborators when Wikidata P18 is missing.
 *
 * Direct CDN URLs (upload.wikimedia.org/…) are returned — no redirect chain,
 * no ERR_BLOCKED_BY_ORB in browsers.
 *
 * Usage:
 *   TMDB_API_KEY=your_key npx tsx scripts/resolveImages.ts
 *
 * Incremental: already-cached entries (non-null) are skipped on re-runs.
 * To re-resolve a specific entry: delete its key from prisma/imageCache.json.
 */

import fs from "fs";
import path from "path";

const CACHE_FILE = path.join(process.cwd(), "prisma", "imageCache.json");
const THUMB_WIDTH = 300;
const UA = "celebridle-seeder/1.0 (https://github.com/example/celebridle)";

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Wikidata SPARQL batch P18 lookup ──────────────────────────────────────────
// Returns a map of { name → Commons filename } for all names with a P18 image.
// Uses SAMPLE() to pick one image per name when multiple exist.

async function sparqlP18(names: string[]): Promise<Map<string, string>> {
  const valuesList = names.map((n) => `"${n.replace(/"/g, '\\"')}"@en`).join("\n    ");
  const sparql = `
SELECT ?name (SAMPLE(?image) AS ?img) WHERE {
  VALUES ?name { ${valuesList} }
  ?entity rdfs:label ?name .
  ?entity wdt:P18 ?image .
  FILTER(LANG(?name) = "en")
}
GROUP BY ?name
`;

  const url =
    `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql.trim())}` +
    `&format=json`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "application/sparql-results+json",
    },
  });

  if (!res.ok) {
    console.warn(`  SPARQL HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    return new Map();
  }

  const data: any = await res.json();
  const result = new Map<string, string>();
  for (const row of data.results?.bindings ?? []) {
    const name: string = row.name?.value;
    const imgUrl: string = row.img?.value; // full Wikimedia Commons URL for the file
    if (name && imgUrl) {
      // imgUrl looks like: http://commons.wikimedia.org/wiki/Special:FilePath/Tom_Hanks.jpg
      const filenameMatch = imgUrl.match(/Special:FilePath\/(.+)$/);
      if (filenameMatch) {
        const filename = decodeURIComponent(filenameMatch[1]);
        result.set(name, filename);
      }
    }
  }
  return result;
}

// ── Wikimedia Commons imageinfo batch ─────────────────────────────────────────
// Given an array of Commons filenames, returns a map of { filename → thumbUrl }.
// Processes up to 50 files per API call.

async function commonsBatchThumbUrls(
  filenames: string[]
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const BATCH = 50;

  for (let i = 0; i < filenames.length; i += BATCH) {
    await sleep(300);
    const batch = filenames.slice(i, i + BATCH);
    const titles = batch.map((f) => `File:${f.replace(/_/g, " ")}`).join("|");
    const url =
      `https://commons.wikimedia.org/w/api.php?action=query` +
      `&titles=${encodeURIComponent(titles)}` +
      `&prop=imageinfo&iiprop=url&iiurlwidth=${THUMB_WIDTH}&format=json`;

    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (!res.ok) continue;
      const data: any = await res.json();
      const pages = data.query?.pages ?? {};
      for (const page of Object.values(pages) as any[]) {
        const thumburl: string | undefined = page?.imageinfo?.[0]?.thumburl;
        const title: string = page?.title ?? "";
        if (thumburl && title.startsWith("File:")) {
          const filename = title.slice("File:".length).replace(/ /g, "_");
          result.set(filename, thumburl);
        }
      }
    } catch (e: any) {
      console.warn(`  Commons batch error: ${e.message}`);
    }
  }
  return result;
}

// ── TMDb fallback ─────────────────────────────────────────────────────────────

async function tmdbPerson(name: string): Promise<string | null> {
  const key = process.env.TMDB_API_KEY;
  if (!key) return null;
  await sleep(250);
  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/person` +
        `?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(name)}&page=1`,
      { headers: { "User-Agent": UA } }
    );
    if (!res.ok) return null;
    const data: any = await res.json();
    const person = (data.results ?? [])[0];
    if (!person?.profile_path) return null;
    return `https://image.tmdb.org/t/p/w300${person.profile_path}`;
  } catch {
    return null;
  }
}

// ── Person lists ──────────────────────────────────────────────────────────────

const FILM_PEOPLE: string[] = [
  // Actors
  "Tom Hanks", "Meryl Streep", "Leonardo DiCaprio", "Scarlett Johansson",
  "Cate Blanchett", "Ryan Reynolds", "Zendaya", "Chris Hemsworth",
  "Margot Robbie", "Dwayne Johnson",
  // Directors
  "Robert Zemeckis", "Mike Nichols", "Martin Scorsese", "Joss Whedon",
  "Peter Jackson", "Shawn Levy", "Denis Villeneuve", "Anthony Russo",
  "David Ayer", "Rawson Marshall Thurber",
  // Collaborators
  "Meg Ryan", "Robin Wright", "Tim Allen",
  "Alec Baldwin", "Anne Hathaway",
  "Kate Winslet", "Brad Pitt",
  "Robert Downey Jr.", "Mark Ruffalo",
  "Samuel L. Jackson", "Anna Faris",
  "Tom Holland", "Timothée Chalamet", "Josh Brolin",
  "Tom Hiddleston", "Chris Evans",
  "Will Smith",
  "Kevin Hart", "Vin Diesel",
];

const ATHLETES: string[] = [
  "LeBron James", "Stephen Curry", "Kobe Bryant",
  "Tom Brady", "Patrick Mahomes", "Jerry Rice",
  "Mike Trout", "Derek Jeter",
  "Wayne Gretzky", "Sidney Crosby",
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  let cache: Record<string, string | null> = {};
  if (fs.existsSync(CACHE_FILE)) {
    cache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    const resolved = Object.values(cache).filter(Boolean).length;
    console.log(
      `Loaded cache: ${resolved} resolved, ${Object.keys(cache).length - resolved} null`
    );
  }

  if (!process.env.TMDB_API_KEY) {
    console.warn(
      "⚠  TMDB_API_KEY not set — film/TV people will use Wikidata only.\n"
    );
  }

  // Determine which names still need resolution
  const filmPending = FILM_PEOPLE.filter((n) => !(cache[n]));
  const athletePending = ATHLETES.filter((n) => !(cache[n]));
  const allPending = [...filmPending, ...athletePending];

  if (!allPending.length) {
    console.log("All entries already resolved. Nothing to do.");
    return;
  }

  console.log(`Resolving ${allPending.length} names via Wikidata SPARQL batch…`);

  // ── Step 1: SPARQL batch P18 lookup ────────────────────────────────────────
  // Wikidata SPARQL has a generous query limit (~1 complex query/s).
  // Split into chunks of 100 names to keep queries fast.
  const SPARQL_CHUNK = 100;
  const p18Map = new Map<string, string>(); // name → Commons filename

  for (let i = 0; i < allPending.length; i += SPARQL_CHUNK) {
    const chunk = allPending.slice(i, i + SPARQL_CHUNK);
    if (i > 0) await sleep(1000);
    console.log(`  SPARQL chunk ${Math.floor(i / SPARQL_CHUNK) + 1}: ${chunk.length} names…`);
    const chunkMap = await sparqlP18(chunk);
    for (const [name, filename] of chunkMap) p18Map.set(name, filename);
    console.log(`    → ${chunkMap.size} P18 filenames found`);
  }

  // ── Step 2: Batch Commons imageinfo for all filenames ──────────────────────
  const filenames = [...new Set(p18Map.values())];
  console.log(`\nFetching ${filenames.length} Commons thumbnails in batches…`);
  const thumbMap = await commonsBatchThumbUrls(filenames); // filename → thumbUrl
  console.log(`  → ${thumbMap.size} thumbnails resolved`);

  // ── Step 3: Build final URL for each person ─────────────────────────────────
  const skipped: string[] = [];

  const resolve = async (name: string, isAthlete: boolean): Promise<string | null> => {
    const filename = p18Map.get(name);
    if (filename) {
      const thumb = thumbMap.get(filename.replace(/ /g, "_"));
      if (thumb) return thumb;
      // Filename found but no thumb — try direct (non-thumb) URL from imageinfo
      const altThumb = thumbMap.get(filename);
      if (altThumb) return altThumb;
    }
    // Wikidata P18 unavailable or Commons failed → TMDb fallback for non-athletes
    if (!isAthlete) return tmdbPerson(name);
    return null;
  };

  console.log("\n── Results ───────────────────────────────────────────────────");
  for (const name of filmPending) {
    const url = await resolve(name, false);
    cache[name] = url;
    if (url) {
      console.log(`  ✓  ${name}`);
    } else {
      console.log(`  ✗  ${name} (no image found)`);
      skipped.push(name);
    }
  }
  for (const name of athletePending) {
    const url = await resolve(name, true);
    cache[name] = url;
    if (url) {
      console.log(`  ✓  ${name}`);
    } else {
      console.log(`  ✗  ${name} (no image found)`);
      skipped.push(name);
    }
  }

  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  const totalResolved = Object.values(cache).filter(Boolean).length;
  console.log(`\n✓ Cache saved (${totalResolved}/${Object.keys(cache).length} with images)`);

  if (skipped.length) {
    console.log(`\n⚠  ${skipped.length} without images (seeded with initial-letter fallback):`);
    skipped.forEach((n) => console.log(`   - ${n}`));
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
