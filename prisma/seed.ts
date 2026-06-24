import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// ── Image cache ───────────────────────────────────────────────────────────────
// Run `npx tsx scripts/resolveImages.ts` to populate this file with verified
// Wikidata P18 / TMDb URLs. When the cache exists, those URLs take priority
// over the hardcoded WP() fallbacks below. A cache entry of `null` means the
// resolution script found no image — the person is skipped entirely.

const CACHE_PATH = path.join(process.cwd(), "prisma", "imageCache.json");
const imageCache: Record<string, string | null> = fs.existsSync(CACHE_PATH)
  ? JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8"))
  : {};

const cacheLoaded = Object.keys(imageCache).length > 0;
if (cacheLoaded) {
  console.log(`Using imageCache.json (${Object.keys(imageCache).length} entries).`);
} else {
  console.log("No imageCache.json found — using hardcoded fallback URLs.");
  console.log("Run `npx tsx scripts/resolveImages.ts` to source verified images.");
}

// Returns: cached URL (if cache loaded) → hardcoded fallback → null (skip)
function imageFor(name: string, hardcoded: string): string | null {
  if (cacheLoaded) {
    // Cache loaded: use it exclusively. null = explicitly skipped.
    return imageCache[name] ?? null;
  }
  return hardcoded;
}

// Hardcoded Wikipedia Special:FilePath fallbacks (used only when no cache).
const WP = (file: string) =>
  `https://en.wikipedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=200`;

// ---------------------------------------------------------------------------
// Actors
// collaborators: [{ name, imageUrl }] — 3 actor co-stars
// director:      { name, imageUrl }   — most frequent collaborating director
//
// imageUrl rules: every entry MUST have a confirmed Wikipedia image URL.
// Do not add a collaborator or director without one.
// ---------------------------------------------------------------------------
const actors = [
  {
    name: "Tom Hanks",
    birthYear: 1956,
    totalCareerGross: BigInt(9_800_000_000),
    majorAwards: 6,
    nationality: "American",
    yearsActive: 45,
    genres: ["Drama", "Comedy", "Animation"],
    numberOfFilms: 72,
    avgCriticScore: 83,
    collaborators: [
      { name: "Meg Ryan",     imageUrl: WP("Meg Ryan.jpg") },
      { name: "Robin Wright", imageUrl: WP("Robin Wright 2014.jpg") },
      { name: "Tim Allen",    imageUrl: WP("Tim Allen 2012.jpg") },
    ],
    director: { name: "Robert Zemeckis", imageUrl: WP("Robert Zemeckis by Gage Skidmore.jpg") },
    imageUrl: WP("Tom Hanks 2014.jpg"),
  },
  {
    name: "Meryl Streep",
    birthYear: 1949,
    totalCareerGross: BigInt(3_800_000_000),
    majorAwards: 9,
    nationality: "American",
    yearsActive: 50,
    genres: ["Drama", "Comedy", "Musical"],
    numberOfFilms: 54,
    avgCriticScore: 88,
    collaborators: [
      { name: "Cate Blanchett",  imageUrl: WP("Cate Blanchett 2022.jpg") },
      { name: "Alec Baldwin",    imageUrl: WP("Alec Baldwin 2012.jpg") },
      { name: "Anne Hathaway",   imageUrl: WP("Anne Hathaway 2018.jpg") },
    ],
    director: { name: "Mike Nichols", imageUrl: WP("Mike Nichols 2011.jpg") },
    imageUrl: WP("Meryl Streep 2012.jpg"),
  },
  {
    name: "Leonardo DiCaprio",
    birthYear: 1974,
    totalCareerGross: BigInt(7_200_000_000),
    majorAwards: 3,
    nationality: "American",
    yearsActive: 33,
    genres: ["Drama", "Thriller", "Crime"],
    numberOfFilms: 37,
    avgCriticScore: 82,
    collaborators: [
      { name: "Kate Winslet",  imageUrl: WP("Kate Winslet 2019.jpg") },
      { name: "Margot Robbie", imageUrl: WP("Margot Robbie 2019.jpg") },
      { name: "Brad Pitt",     imageUrl: WP("Brad Pitt 2019 by Glenn Francis.jpg") },
    ],
    director: { name: "Martin Scorsese", imageUrl: WP("Martin Scorsese 2010.jpg") },
    imageUrl: WP("Leonardo DiCaprio 2014.jpg"),
  },
  {
    name: "Scarlett Johansson",
    birthYear: 1984,
    totalCareerGross: BigInt(14_300_000_000),
    majorAwards: 0,
    nationality: "American",
    yearsActive: 32,
    genres: ["Action", "Sci-Fi", "Drama"],
    numberOfFilms: 50,
    avgCriticScore: 72,
    collaborators: [
      { name: "Chris Hemsworth",    imageUrl: WP("Chris Hemsworth by Gage Skidmore.jpg") },
      { name: "Robert Downey Jr.",  imageUrl: WP("Robert Downey Jr 2014 (cropped).jpg") },
      { name: "Mark Ruffalo",       imageUrl: WP("Mark Ruffalo 2014.jpg") },
    ],
    director: { name: "Joss Whedon", imageUrl: WP("Joss Whedon by Gage Skidmore.jpg") },
    imageUrl: WP("Scarlett Johansson by Gage Skidmore 2.jpg"),
  },
  {
    name: "Cate Blanchett",
    birthYear: 1969,
    totalCareerGross: BigInt(4_500_000_000),
    majorAwards: 5,
    nationality: "Australian",
    yearsActive: 32,
    genres: ["Drama", "Fantasy", "Thriller"],
    numberOfFilms: 60,
    avgCriticScore: 87,
    collaborators: [
      { name: "Brad Pitt",     imageUrl: WP("Brad Pitt 2019 by Glenn Francis.jpg") },
      { name: "Meryl Streep",  imageUrl: WP("Meryl Streep 2012.jpg") },
      { name: "Kate Winslet",  imageUrl: WP("Kate Winslet 2019.jpg") },
    ],
    director: { name: "Peter Jackson", imageUrl: WP("Peter Jackson 2009.jpg") },
    imageUrl: WP("Cate Blanchett 2022.jpg"),
  },
  {
    name: "Ryan Reynolds",
    birthYear: 1976,
    totalCareerGross: BigInt(6_100_000_000),
    majorAwards: 0,
    nationality: "Canadian",
    yearsActive: 30,
    genres: ["Comedy", "Action", "Sci-Fi"],
    numberOfFilms: 45,
    avgCriticScore: 60,
    collaborators: [
      { name: "Dwayne Johnson",    imageUrl: WP("Dwayne Johnson 2, 2012.jpg") },
      { name: "Samuel L. Jackson", imageUrl: WP("Samuel L Jackson 2012.jpg") },
      { name: "Anna Faris",        imageUrl: WP("Anna Faris 2011.jpg") },
    ],
    director: { name: "Shawn Levy", imageUrl: WP("Shawn Levy by Gage Skidmore.jpg") },
    imageUrl: WP("Ryan Reynolds by Gage Skidmore.jpg"),
  },
  {
    name: "Zendaya",
    birthYear: 1996,
    totalCareerGross: BigInt(3_200_000_000),
    majorAwards: 2,
    nationality: "American",
    yearsActive: 15,
    genres: ["Drama", "Sci-Fi", "Action"],
    numberOfFilms: 16,
    avgCriticScore: 85,
    collaborators: [
      { name: "Tom Holland",         imageUrl: WP("Tom Holland 2019.jpg") },
      { name: "Timothée Chalamet",   imageUrl: WP("Timothée Chalamet 2018.jpg") },
      { name: "Josh Brolin",         imageUrl: WP("Josh Brolin 2018.jpg") },
    ],
    director: { name: "Denis Villeneuve", imageUrl: WP("Denis Villeneuve 2015 (cropped).jpg") },
    imageUrl: WP("Zendaya at the 2019 CFDA Fashion Awards (cropped).jpg"),
  },
  {
    name: "Chris Hemsworth",
    birthYear: 1983,
    totalCareerGross: BigInt(11_500_000_000),
    majorAwards: 0,
    nationality: "Australian",
    yearsActive: 20,
    genres: ["Action", "Sci-Fi", "Adventure"],
    numberOfFilms: 35,
    avgCriticScore: 65,
    collaborators: [
      { name: "Scarlett Johansson", imageUrl: WP("Scarlett Johansson by Gage Skidmore 2.jpg") },
      { name: "Tom Hiddleston",     imageUrl: WP("Tom Hiddleston 2016.jpg") },
      { name: "Chris Evans",        imageUrl: WP("Chris Evans 2015.jpg") },
    ],
    director: { name: "Anthony Russo", imageUrl: WP("Anthony Russo 2019.jpg") },
    imageUrl: WP("Chris Hemsworth by Gage Skidmore.jpg"),
  },
  {
    name: "Margot Robbie",
    birthYear: 1990,
    totalCareerGross: BigInt(6_800_000_000),
    majorAwards: 0,
    nationality: "Australian",
    yearsActive: 15,
    genres: ["Drama", "Comedy", "Action"],
    numberOfFilms: 28,
    avgCriticScore: 78,
    collaborators: [
      { name: "Leonardo DiCaprio", imageUrl: WP("Leonardo DiCaprio 2014.jpg") },
      { name: "Will Smith",        imageUrl: WP("Will Smith 2012.jpg") },
      { name: "Brad Pitt",         imageUrl: WP("Brad Pitt 2019 by Glenn Francis.jpg") },
    ],
    director: { name: "David Ayer", imageUrl: WP("David Ayer 2014.jpg") },
    imageUrl: WP("Margot Robbie 2019.jpg"),
  },
  {
    name: "Dwayne Johnson",
    birthYear: 1972,
    totalCareerGross: BigInt(10_500_000_000),
    majorAwards: 0,
    nationality: "American",
    yearsActive: 25,
    genres: ["Action", "Comedy", "Adventure"],
    numberOfFilms: 58,
    avgCriticScore: 45,
    collaborators: [
      { name: "Ryan Reynolds", imageUrl: WP("Ryan Reynolds by Gage Skidmore.jpg") },
      { name: "Kevin Hart",    imageUrl: WP("Kevin Hart 2014.jpg") },
      { name: "Vin Diesel",    imageUrl: WP("Vin Diesel 2018.jpg") },
    ],
    director: { name: "Rawson Marshall Thurber", imageUrl: WP("Rawson Marshall Thurber 2019.jpg") },
    imageUrl: WP("Dwayne Johnson 2, 2012.jpg"),
  },
];

// ---------------------------------------------------------------------------
// Athletes — NFL, MLB, NBA, NHL only
// allStarSelections = NBA/MLB/NHL All-Star Game appearances,
//                     or NFL First-Team All-Pro selections
// ---------------------------------------------------------------------------
const athletes = [
  // ── NBA ────────────────────────────────────────────────────────────────────
  {
    name: "LeBron James",
    birthYear: 1984,
    sport: "NBA",
    team: "Los Angeles Lakers",
    position: "Forward",
    heightCm: 206,
    allStarSelections: 20,
    yearsActive: 23,
    imageUrl: WP("LeBron James crop.jpg"),
  },
  {
    name: "Stephen Curry",
    birthYear: 1988,
    sport: "NBA",
    team: "Golden State Warriors",
    position: "Point Guard",
    heightCm: 188,
    allStarSelections: 10,
    yearsActive: 16,
    imageUrl: WP("Stephen Curry Shooting.jpg"),
  },
  {
    name: "Kobe Bryant",
    birthYear: 1978,
    sport: "NBA",
    team: "Los Angeles Lakers",
    position: "Shooting Guard",
    heightCm: 198,
    allStarSelections: 18,
    yearsActive: 20,
    imageUrl: WP("Kobe Bryant 2014.jpg"),
  },
  // ── NFL ────────────────────────────────────────────────────────────────────
  {
    name: "Tom Brady",
    birthYear: 1977,
    sport: "NFL",
    team: "New England Patriots",
    position: "Quarterback",
    heightCm: 193,
    allStarSelections: 3,
    yearsActive: 23,
    imageUrl: WP("Tom Brady (American football) 2016.jpg"),
  },
  {
    name: "Patrick Mahomes",
    birthYear: 1995,
    sport: "NFL",
    team: "Kansas City Chiefs",
    position: "Quarterback",
    heightCm: 188,
    allStarSelections: 4,
    yearsActive: 9,
    imageUrl: WP("Patrick Mahomes (cropped).jpg"),
  },
  {
    name: "Jerry Rice",
    birthYear: 1962,
    sport: "NFL",
    team: "San Francisco 49ers",
    position: "Wide Receiver",
    heightCm: 185,
    allStarSelections: 10,
    yearsActive: 20,
    imageUrl: WP("Jerry Rice crop.jpg"),
  },
  // ── MLB ────────────────────────────────────────────────────────────────────
  {
    name: "Mike Trout",
    birthYear: 1991,
    sport: "MLB",
    team: "Los Angeles Angels",
    position: "Center Field",
    heightCm: 188,
    allStarSelections: 11,
    yearsActive: 15,
    imageUrl: WP("Mike Trout (37556254621) (cropped).jpg"),
  },
  {
    name: "Derek Jeter",
    birthYear: 1974,
    sport: "MLB",
    team: "New York Yankees",
    position: "Shortstop",
    heightCm: 190,
    allStarSelections: 14,
    yearsActive: 20,
    imageUrl: WP("Derek Jeter.jpg"),
  },
  // ── NHL ────────────────────────────────────────────────────────────────────
  {
    name: "Wayne Gretzky",
    birthYear: 1961,
    sport: "NHL",
    team: "Edmonton Oilers",
    position: "Center",
    heightCm: 183,
    allStarSelections: 18,
    yearsActive: 21,
    imageUrl: WP("Wayne Gretzky 2011.jpg"),
  },
  {
    name: "Sidney Crosby",
    birthYear: 1987,
    sport: "NHL",
    team: "Pittsburgh Penguins",
    position: "Center",
    heightCm: 180,
    allStarSelections: 9,
    yearsActive: 21,
    imageUrl: WP("Sidney Crosby 2009.jpg"),
  },
];

async function main() {
  console.log("Seeding actors...");
  for (const actor of actors) {
    // Resolve imageUrls through cache when available; fall through to hardcoded otherwise.
    const imageUrl = imageFor(actor.name, actor.imageUrl as string);

    const collaborators = (actor.collaborators as Array<{ name: string; imageUrl: string }>).map(
      (c) => ({ name: c.name, imageUrl: imageFor(c.name, c.imageUrl) })
    );
    const dirRaw = actor.director as { name: string; imageUrl: string };
    const director = { name: dirRaw.name, imageUrl: imageFor(dirRaw.name, dirRaw.imageUrl) };

    const data = { ...actor, imageUrl, collaborators, director };
    await prisma.actor.upsert({ where: { name: actor.name }, update: data, create: data });
  }

  console.log("Clearing old athletes and reseeding...");
  await prisma.athlete.deleteMany({});
  for (const athlete of athletes) {
    const imageUrl = imageFor(athlete.name, athlete.imageUrl as string);
    await prisma.athlete.create({ data: { ...athlete, imageUrl } });
  }

  console.log(`Seeded ${actors.length} actors, ${athletes.length} athletes.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
