import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });

async function main() {
  // ── 5 random athletes ───────────────────────────────────────────────────────
  const athletes = await prisma.athlete.findMany({
    where: { name: { in: ["Aaron Rodgers", "Isiah Thomas", "Kristaps Porzingis", "Aqib Talib", "LeBron James"] } },
    select: { name: true, sport: true, team: true, position: true, heightCm: true, allStarSelections: true, yearsActive: true, birthYear: true },
  });
  console.log("\n=== 5 ATHLETE DB ENTRIES ===");
  for (const a of athletes) console.log(JSON.stringify(a));

  // ── 5 random actors ─────────────────────────────────────────────────────────
  const actors = await prisma.actor.findMany({
    where: { name: { in: ["Harrison Ford", "Adam Driver", "Tom Hanks", "Meryl Streep", "Cate Blanchett"] } },
    select: { name: true, birthYear: true, nationality: true, yearsActive: true, genres: true, numberOfFilms: true, avgCriticScore: true, majorAwards: true, totalCareerGross: true, collaborators: true, director: true },
  });
  console.log("\n=== 5 ACTOR DB ENTRIES ===");
  for (const a of actors) {
    // totalCareerGross is BigInt in Prisma 7 — convert to number for logging
    const row = { ...a, totalCareerGross: Number((a as any).totalCareerGross ?? 0) };
    console.log(JSON.stringify(row));
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
