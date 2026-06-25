import { prisma } from "./db";
import {
  numericCompare,
  boolCompare,
  absDiff,
  type NumericResult,
  type BoolResult,
} from "./compare";

const EPOCH = new Date("2025-01-01").getTime();

// 2 inches in cm
const heightClose = (g: number, a: number) => Math.abs(g - a) <= 2 * 2.54;

export type TeamEntry = {
  name: string;
  logoUrl: string | null;
  highlighted: boolean;
};

export type AthleteComparison = {
  name: string;
  imageUrl: string | null;
  age: NumericResult;
  sport: BoolResult;
  position: BoolResult;
  heightCm: NumericResult;
  allStarSelections: NumericResult;
  yearsActive: NumericResult;
  teams: TeamEntry[];
  isCorrect: boolean;
};

type StoredTeam = { name: string; logoUrl: string | null };

export async function getDailyAthlete() {
  const dayIndex = Math.floor((Date.now() - EPOCH) / 86_400_000);
  const all = await prisma.athlete.findMany({ orderBy: { id: "asc" } });
  return all[dayIndex % all.length];
}

export async function getAllAthleteNames(): Promise<string[]> {
  const all = await prisma.athlete.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return all.map((a) => a.name);
}

export async function compareAthlete(
  guessName: string,
  currentYear: number
): Promise<AthleteComparison | null> {
  const [answer, guess] = await Promise.all([
    getDailyAthlete(),
    prisma.athlete.findUnique({ where: { name: guessName } }),
  ]);

  if (!guess) return null;

  const guessTeams  = (guess.teams  as StoredTeam[]) ?? [];
  const answerTeams = (answer.teams as StoredTeam[]) ?? [];
  const answerTeamNames = new Set(answerTeams.map((t) => t.name));

  return {
    name: guess.name,
    imageUrl: guess.imageUrl ?? null,
    age: numericCompare(currentYear - guess.birthYear, currentYear - answer.birthYear, absDiff(5)),
    sport: boolCompare(guess.sport, answer.sport),
    position: boolCompare(guess.position, answer.position),
    heightCm: numericCompare(guess.heightCm, answer.heightCm, heightClose),
    allStarSelections: numericCompare(guess.allStarSelections, answer.allStarSelections, absDiff(2)),
    yearsActive: numericCompare(guess.yearsActive, answer.yearsActive, absDiff(5)),
    teams: guessTeams.map((t) => ({
      name: t.name,
      logoUrl: t.logoUrl,
      highlighted: answerTeamNames.has(t.name),
    })),
    isCorrect: guess.id === answer.id,
  };
}
