/**
 * Manual patch for actors whose Academy Award win counts are wrong in the DB.
 * Only corrects actors where Wikipedia text extraction fails (multi-Oscar winners).
 *
 * Usage: DATABASE_URL=... npx tsx scripts/patchActorAwards.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

// Known correct Oscar win counts for actors whose DB value is wrong
// Source: Academy Awards official records
const OSCAR_WINS: Record<string, number> = {
  "Katharine Hepburn":    4,
  "Meryl Streep":         3,
  "Jack Nicholson":       3,
  "Ingrid Bergman":       3,
  "Walter Brennan":       3,
  "Daniel Day-Lewis":     3,
  "Frances McDormand":    3,
  "Robert De Niro":       2,
  "Denzel Washington":    2,
  "Marlon Brando":        2,
  "Spencer Tracy":        2,
  "Fredric March":        2,
  "Gary Cooper":          2,
  "Vivien Leigh":         2,
  "Elizabeth Taylor":     2,
  "Jane Fonda":           2,
  "Glenda Jackson":       2,
  "Hilary Swank":         2,
  "Cate Blanchett":       2,
  "Olivia de Havilland":  2,
  "Joanne Woodward":      1,
  "Diane Keaton":         1,
  "Sidney Poitier":       1,
  "Halle Berry":          1,
  "Lupita Nyong'o":       1,
  "Viola Davis":          1,
  "Natalie Portman":      1,
  "Charlize Theron":      1,
  "Sandra Bullock":       1,
  "Jennifer Lawrence":    1,
  "Brie Larson":          1,
  "Emma Stone":           1,
  "Joaquin Phoenix":      1,
  "Rami Malek":           1,
  "Gary Oldman":          1,
  "Anthony Hopkins":      2,
  "Brando":               2,
};

async function main() {
  const actors = await prisma.actor.findMany({
    select: { id: true, name: true, majorAwards: true },
  });

  let patched = 0;
  for (const actor of actors) {
    const correct = OSCAR_WINS[actor.name];
    if (correct !== undefined && correct !== actor.majorAwards) {
      await prisma.actor.update({
        where: { id: actor.id },
        data: { majorAwards: correct },
      });
      console.log(`  ${actor.name}: majorAwards ${actor.majorAwards} → ${correct}`);
      patched++;
    }
  }

  console.log(`\nPatched ${patched} actors.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
