"use server";

import { compareAthlete, getDailyAthlete } from "@/lib/athleteGame";
import type { AthleteComparison } from "@/lib/athleteGame";

export async function submitAthleteGuess(
  name: string
): Promise<AthleteComparison | { error: string }> {
  if (!name.trim()) return { error: "Please enter a name." };
  const result = await compareAthlete(name, new Date().getFullYear());
  if (!result) return { error: `"${name}" not found in our athlete database.` };
  return result;
}

export async function getAthletedleAnswer(): Promise<{ name: string; imageUrl: string | null }> {
  const athlete = await getDailyAthlete();
  return { name: athlete.name, imageUrl: athlete.imageUrl ?? null };
}
