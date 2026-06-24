"use server";

import { compareActor } from "@/lib/actorGame";
import type { ActorComparison } from "@/lib/actorGame";

export async function submitActorGuess(
  name: string
): Promise<ActorComparison | { error: string }> {
  if (!name.trim()) return { error: "Please enter a name." };
  const result = await compareActor(name, new Date().getFullYear());
  if (!result) return { error: `"${name}" not found in our actor database.` };
  return result;
}
