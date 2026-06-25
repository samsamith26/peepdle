/**
 * One-time patch: correct team name casing issues from the wikiUpdate run.
 * - "Seattle Supersonics" → "Seattle SuperSonics"
 *
 * Usage: DATABASE_URL=... npx tsx scripts/patchTeamCasing.ts
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg(process.env.DATABASE_URL!);
const prisma = new PrismaClient({ adapter });

const FIXES: Record<string, string> = {
  "Seattle Supersonics": "Seattle SuperSonics",
  "Mighty Ducks Of Anaheim": "Mighty Ducks of Anaheim",
};

async function main() {
  const athletes = await prisma.athlete.findMany({
    select: { id: true, name: true, team: true, teams: true },
  });

  let patched = 0;

  for (const athlete of athletes) {
    const teamsRaw = (athlete.teams as Array<{ name: string; logoUrl: string | null }>) ?? [];
    let changed = false;
    const newTeams = teamsRaw.map((t) => {
      const fix = FIXES[t.name];
      if (fix) { changed = true; return { ...t, name: fix }; }
      return t;
    });
    const newTeam = FIXES[athlete.team ?? ""] ?? athlete.team;
    const teamChanged = newTeam !== athlete.team;

    if (changed || teamChanged) {
      await prisma.athlete.update({
        where: { id: athlete.id },
        data: {
          ...(changed ? { teams: newTeams } : {}),
          ...(teamChanged ? { team: newTeam } : {}),
        },
      });
      console.log(`  ${athlete.name}: ${changed ? `teams fixed` : ""} ${teamChanged ? `team: ${athlete.team} → ${newTeam}` : ""}`);
      patched++;
    }
  }

  console.log(`\nPatched ${patched} athletes.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
