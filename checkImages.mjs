import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter });

const actors = await prisma.actor.findMany({ select: { name: true, imageUrl: true } });
const athletes = await prisma.athlete.findMany({ select: { name: true, imageUrl: true } });

console.log("=== ACTORS ===");
for (const a of actors) {
  console.log(`  ${a.name}: ${a.imageUrl ?? "(null)"}`);
}

console.log("\n=== ATHLETES ===");
for (const a of athletes) {
  console.log(`  ${a.name}: ${a.imageUrl ?? "(null)"}`);
}

await prisma.$disconnect();
