import { getAllAthleteNames } from "@/lib/athleteGame";
import AthletedleGame from "./game";

export const metadata = { title: "Athletedle" };

export default async function AthletedlePage() {
  const names = await getAllAthleteNames();
  return <AthletedleGame names={names} />;
}
