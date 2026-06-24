import { getAllActorNames } from "@/lib/actorGame";
import ActordleGame from "./game";

export const metadata = { title: "Actordle" };

export default async function ActordlePage() {
  const names = await getAllActorNames();
  return <ActordleGame names={names} />;
}
