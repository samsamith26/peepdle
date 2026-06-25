"use server";

import { compareActor, getDailyActor } from "@/lib/actorGame";
import type { ActorComparison } from "@/lib/actorGame";

export async function submitActorGuess(
  name: string
): Promise<ActorComparison | { error: string }> {
  if (!name.trim()) return { error: "Please enter a name." };
  const result = await compareActor(name, new Date().getFullYear());
  if (!result) return { error: `"${name}" not found in our actor database.` };
  return result;
}

export async function getActordleAnswer(): Promise<{ name: string; imageUrl: string | null }> {
  const actor = await getDailyActor();
  return { name: actor.name, imageUrl: actor.imageUrl ?? null };
}
