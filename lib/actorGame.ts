import { prisma } from "./db";
import {
  numericCompare,
  boolCompare,
  absDiff,
  pctDiff,
  type NumericResult,
  type BoolResult,
} from "./compare";

const EPOCH = new Date("2025-01-01").getTime();

// Shape stored in the `collaborators` JSON array and `director` JSON object.
// Every entry is guaranteed to have an imageUrl — see seed.ts constraint.
type CollabPerson = { name: string; imageUrl: string };

export type CollabEntry = {
  name: string;
  isDirector: boolean;
  highlighted: boolean;
  imageUrl: string;
  isEmpty?: boolean;
};

export type GenreTag = {
  genre: string;
  highlighted: boolean;
};

export type ActorComparison = {
  name: string;
  imageUrl: string | null;
  age: NumericResult;
  totalCareerGross: NumericResult;
  majorAwards: NumericResult;
  nationality: BoolResult;
  yearsActive: NumericResult;
  genres: GenreTag[];
  numberOfFilms: NumericResult;
  avgCriticScore: NumericResult;
  collabs: CollabEntry[];
  isCorrect: boolean;
};

export async function getDailyActor() {
  const dayIndex = Math.floor((Date.now() - EPOCH) / 86_400_000);
  const all = await prisma.actor.findMany({ orderBy: { id: "asc" } });
  return all[dayIndex % all.length];
}

export async function getAllActorNames(): Promise<string[]> {
  const all = await prisma.actor.findMany({
    select: { name: true },
    orderBy: { name: "asc" },
  });
  return all.map((a) => a.name);
}

const EMPTY_COLLAB: CollabEntry = {
  name: "",
  imageUrl: "",
  isDirector: false,
  highlighted: false,
  isEmpty: true,
};

export async function compareActor(
  guessName: string,
  currentYear: number
): Promise<ActorComparison | null> {
  const [answer, guess, poolNames] = await Promise.all([
    getDailyActor(),
    prisma.actor.findUnique({ where: { name: guessName } }),
    prisma.actor.findMany({ select: { name: true } }),
  ]);

  if (!guess) return null;

  const poolNameSet = new Set(poolNames.map((a) => a.name));

  // Only show collaborators who are themselves in our actor pool
  const guessCollabs = (guess.collaborators as CollabPerson[])
    .filter((c) => c.name !== guess.name && poolNameSet.has(c.name))
    .slice(0, 3);
  const guessDirector = guess.director as CollabPerson;
  const answerCollabs = (answer.collaborators as CollabPerson[])
    .filter((c) => c.name !== answer.name && poolNameSet.has(c.name));
  const answerDirector = answer.director as CollabPerson;

  const answerCollabNames = new Set(answerCollabs.map((c) => c.name));
  const answerGenreSet = new Set(answer.genres);

  // Use age at death for deceased actors instead of counting against today
  const guessAge  = (guess.deathYear  ?? currentYear) - guess.birthYear;
  const answerAge = (answer.deathYear ?? currentYear) - answer.birthYear;

  const actorCollabEntries: CollabEntry[] = guessCollabs.map((c) => ({
    name: c.name,
    imageUrl: c.imageUrl,
    isDirector: false,
    highlighted: answerCollabNames.has(c.name),
  }));

  // Pad to exactly 3 actor collab slots
  while (actorCollabEntries.length < 3) {
    actorCollabEntries.push({ ...EMPTY_COLLAB });
  }

  return {
    name: guess.name,
    imageUrl: guess.imageUrl ?? null,
    age: numericCompare(guessAge, answerAge, absDiff(5)),
    totalCareerGross: numericCompare(
      Number(guess.totalCareerGross),
      Number(answer.totalCareerGross),
      pctDiff(0.25)
    ),
    majorAwards: numericCompare(guess.majorAwards, answer.majorAwards, absDiff(2)),
    nationality: boolCompare(guess.nationality, answer.nationality),
    yearsActive: numericCompare(guess.yearsActive, answer.yearsActive, absDiff(5)),
    genres: guess.genres.map((genre) => ({
      genre,
      highlighted: answerGenreSet.has(genre),
    })),
    numberOfFilms: numericCompare(guess.numberOfFilms, answer.numberOfFilms, absDiff(10)),
    avgCriticScore: numericCompare(guess.avgCriticScore, answer.avgCriticScore, pctDiff(0.10)),
    collabs: [
      ...actorCollabEntries,
      {
        name: guessDirector.name,
        imageUrl: guessDirector.imageUrl,
        isDirector: true,
        highlighted: guessDirector.name === answerDirector.name,
      },
    ],
    isCorrect: guess.id === answer.id,
  };
}
