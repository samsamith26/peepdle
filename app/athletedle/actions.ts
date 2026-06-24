"use server";

import { compareAthlete } from "@/lib/athleteGame";
import type { AthleteComparison } from "@/lib/athleteGame";

export async function submitAthleteGuess(
  name: string
): Promise<AthleteComparison | { error: string }> {
  if (!name.trim()) return { error: "Please enter a name." };
  const result = await compareAthlete(name, new Date().getFullYear());
  if (!result) return { error: `"${name}" not found in our athlete database.` };
  return result;
}
