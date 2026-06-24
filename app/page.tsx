import Link from "next/link";

export const metadata = { title: "Daily Games" };

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-10 px-4">
      <div className="text-center">
        <h1 className="text-5xl font-black tracking-tight">Daily Games</h1>
        <p className="text-zinc-400 mt-2 text-sm">
          One mystery celebrity per category, updated daily
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 w-full max-w-sm">
        <Link
          href="/actordle"
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 rounded-2xl p-6 text-center transition-all"
        >
          <div className="text-4xl mb-3">🎬</div>
          <h2 className="text-xl font-bold text-white">Actordle</h2>
          <p className="text-zinc-400 text-sm mt-1">Guess today&apos;s actor</p>
        </Link>

        <Link
          href="/athletedle"
          className="flex-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-zinc-500 rounded-2xl p-6 text-center transition-all"
        >
          <div className="text-4xl mb-3">🏆</div>
          <h2 className="text-xl font-bold text-white">Athletedle</h2>
          <p className="text-zinc-400 text-sm mt-1">Guess today&apos;s athlete</p>
        </Link>
      </div>
    </div>
  );
}
