"use client";

import { useState, useRef, useTransition, useEffect } from "react";
import { submitActorGuess, getActordleAnswer } from "./actions";
import type { ActorComparison, CollabEntry } from "@/lib/actorGame";
import type { Closeness, Direction } from "@/lib/compare";

const MAX_GUESSES = 10;
const EPOCH = new Date("2025-01-01").getTime();
const DAY = Math.floor((Date.now() - EPOCH) / 86_400_000) + 1;

const fmtGross = (n: number): string => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(0)}M`;
  return `$${n}`;
};

// ── Emoji share helpers ────────────────────────────────────────────────────────

function closenessEmoji(c: Closeness): string {
  return c === "exact" ? "🟩" : c === "close" ? "🟨" : "⬜";
}

function boolEmoji(match: boolean): string {
  return match ? "🟩" : "⬜";
}

function guessRow(g: ActorComparison): string {
  return [
    closenessEmoji(g.age.closeness),
    closenessEmoji(g.totalCareerGross.closeness),
    closenessEmoji(g.majorAwards.closeness),
    boolEmoji(g.nationality.match),
    closenessEmoji(g.yearsActive.closeness),
    closenessEmoji(g.numberOfFilms.closeness),
    boolEmoji(g.genres.some((t) => t.highlighted)),
  ].join("");
}

// ── Tile component ─────────────────────────────────────────────────────────────

type TileProps = { label: string; value: string; className?: string; wrap?: boolean } & (
  | { kind: "num"; direction: Direction; closeness: Closeness }
  | { kind: "bool"; match: boolean }
);

function Tile(props: TileProps) {
  let bg: string;
  let labelColor: string;
  let arrow = "";

  if (props.kind === "bool") {
    bg = props.match ? "bg-green-600" : "bg-zinc-600";
    labelColor = "text-white/50";
  } else {
    arrow =
      props.direction === "higher" ? " ↑" : props.direction === "lower" ? " ↓" : "";
    switch (props.closeness) {
      case "exact":
        bg = "bg-green-600";
        labelColor = "text-white/50";
        break;
      case "close":
        bg = "bg-yellow-400";
        labelColor = "text-zinc-900/60";
        break;
      default:
        bg = "bg-zinc-600";
        labelColor = "text-white/50";
    }
  }

  return (
    <div
      className={`${bg} rounded-lg px-2 py-2 flex flex-col items-center justify-center min-w-0 ${props.className ?? ""}`}
    >
      <span className={`text-[8px] font-semibold uppercase tracking-widest leading-none mb-1 truncate w-full text-center ${labelColor}`}>
        {props.label}
      </span>
      <span
        className={`text-sm font-black leading-tight text-center text-white ${
          props.wrap ? "whitespace-normal break-words w-full" : "truncate w-full"
        }`}
      >
        {props.value}{arrow}
      </span>
    </div>
  );
}

// ── Avatar (main) ─────────────────────────────────────────────────────────────

function Avatar({ src, name, isCorrect }: { src: string | null; name: string; isCorrect: boolean }) {
  const [err, setErr] = useState(false);
  return (
    <div
      className={`flex-shrink-0 w-36 h-36 rounded-xl overflow-hidden bg-zinc-700 ${
        isCorrect ? "ring-2 ring-green-500" : "ring-1 ring-zinc-600"
      }`}
    >
      {src && !err ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={name} className="w-full h-full object-cover object-top" onError={() => setErr(true)} />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl font-black text-zinc-400 select-none">
          {name[0]}
        </div>
      )}
    </div>
  );
}

// ── Collab circular photo ─────────────────────────────────────────────────────

function CollabPhoto({ entry }: { entry: CollabEntry }) {
  const [err, setErr] = useState(false);
  if (entry.isEmpty) {
    return (
      <div className="w-11 h-11 rounded-full bg-zinc-800 ring-1 ring-zinc-700 flex-shrink-0 flex items-center justify-center">
        <span className="text-zinc-700 text-lg font-black select-none">?</span>
      </div>
    );
  }
  const ring = entry.highlighted ? "ring-2 ring-green-500" : "ring-1 ring-zinc-600";
  return (
    <div className={`w-11 h-11 rounded-full overflow-hidden bg-zinc-700 flex-shrink-0 ${ring}`}>
      {entry.imageUrl && !err ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={entry.imageUrl}
          alt={entry.name}
          className="w-full h-full object-cover object-top"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-base font-black text-zinc-400 select-none">
          {entry.name[0]}
        </div>
      )}
    </div>
  );
}

// ── Answer reveal ─────────────────────────────────────────────────────────────

function AnswerReveal({ name, imageUrl }: { name: string; imageUrl: string | null }) {
  const [imgErr, setImgErr] = useState(false);
  return (
    <div className="flex flex-col items-center gap-3 mt-4 mb-1">
      <p className="text-zinc-400 text-xs uppercase tracking-widest font-semibold">The answer was</p>
      <div className="w-20 h-20 rounded-xl overflow-hidden bg-zinc-700 ring-1 ring-zinc-600">
        {imageUrl && !imgErr ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt={name} className="w-full h-full object-cover object-top" onError={() => setImgErr(true)} />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-2xl font-black text-zinc-400 select-none">{name[0]}</div>
        )}
      </div>
      <p className="text-xl font-black text-white">{name}</p>
    </div>
  );
}

// ── Guess card ─────────────────────────────────────────────────────────────────

function ActorCard({ row }: { row: ActorComparison }) {
  const director = row.collabs.find((c) => c.isDirector)!;
  const actorCollabs = row.collabs.filter((c) => !c.isDirector);

  return (
    <div
      className={`flex flex-col rounded-xl border overflow-hidden ${
        row.isCorrect ? "border-green-500" : "border-zinc-700"
      } bg-zinc-800/80`}
    >
      {/* Top section: photo + name / genres / tiles */}
      <div className="flex gap-4 items-start p-4">
        <Avatar src={row.imageUrl} name={row.name} isCorrect={row.isCorrect} />

        <div className="flex-1 min-w-0 flex flex-col gap-2">
          <p className="font-bold text-white text-base leading-tight">{row.name}</p>

          {/* Genre tags */}
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-[8px] font-semibold uppercase tracking-widest opacity-50 text-zinc-400 mr-0.5">
              Genres
            </span>
            {row.genres.map((t) => (
              <span
                key={t.genre}
                className={`text-[10px] font-semibold px-2 py-0.5 rounded-full leading-tight ${
                  t.highlighted ? "bg-green-600 text-white" : "bg-zinc-700 text-zinc-300"
                }`}
              >
                {t.genre}
              </span>
            ))}
          </div>

          {/* Attribute tiles: 4-col grid, Country spans both rows */}
          <div className="grid grid-cols-4 gap-1.5">
            <Tile kind="num"  label="Age"       value={String(row.age.value)}                direction={row.age.direction}             closeness={row.age.closeness} />
            <Tile kind="num"  label="Gross"     value={fmtGross(row.totalCareerGross.value)} direction={row.totalCareerGross.direction} closeness={row.totalCareerGross.closeness} />
            <Tile kind="num"  label="Awards"    value={String(row.majorAwards.value)}        direction={row.majorAwards.direction}      closeness={row.majorAwards.closeness} />
            <Tile kind="bool" label="Country"   value={row.nationality.value}                match={row.nationality.match}              className="row-span-2" wrap />
            <Tile kind="num"  label="Yrs Active" value={String(row.yearsActive.value)}       direction={row.yearsActive.direction}      closeness={row.yearsActive.closeness} />
            <Tile kind="num"  label="Films"      value={String(row.numberOfFilms.value)}     direction={row.numberOfFilms.direction}    closeness={row.numberOfFilms.closeness} />
            <Tile kind="num"  label="RT Score"   value={row.avgCriticScore.value > 0 ? `${Math.round(row.avgCriticScore.value)}%` : "—"} direction={row.avgCriticScore.direction} closeness={row.avgCriticScore.closeness} />
          </div>
        </div>
      </div>

      {/* Bottom section: full-width collaborators bar, split Director | Actors */}
      <div className="border-t border-zinc-700/60 px-4 py-3">
        <div className="flex items-stretch">

          {/* Director group */}
          <div className="flex-1 flex flex-col items-center gap-2">
            <span className="text-[8px] font-semibold uppercase tracking-widest text-zinc-500 leading-none">
              Director
            </span>
            <CollabPhoto entry={director} />
            <span
              className={`text-[10px] font-semibold text-center leading-tight ${
                director.highlighted ? "text-green-400" : "text-zinc-300"
              }`}
            >
              {director.name}
            </span>
          </div>

          {/* Vertical divider */}
          <div className="self-stretch w-px bg-zinc-700 mx-3" />

          {/* Actors group */}
          <div className="flex-[3] flex flex-col items-center gap-2">
            <span className="text-[8px] font-semibold uppercase tracking-widest text-zinc-500 leading-none">
              Actors
            </span>
            <div className="flex w-full justify-around">
              {actorCollabs.map((c, i) => (
                <div key={c.isEmpty ? `empty-${i}` : c.name} className="flex flex-col items-center gap-1.5">
                  <CollabPhoto entry={c} />
                  <span
                    className={`text-[10px] font-semibold text-center leading-tight max-w-[4.5rem] ${
                      c.highlighted ? "text-green-400" : c.isEmpty ? "text-zinc-700" : "text-zinc-300"
                    }`}
                  >
                    {c.isEmpty ? "—" : c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Share button ───────────────────────────────────────────────────────────────

function ShareButton({ guesses, won }: { guesses: ActorComparison[]; won: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const chronological = [...guesses].reverse();
    const grid = chronological.map(guessRow).join("\n");
    const result = won ? `${guesses.length}/10` : "X/10";
    const text = `🎬 Actordle — Day ${DAY}\n${result}\n\n${grid}`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleShare}
      className="mt-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-100 text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
    >
      {copied ? "Copied!" : "Share results"}
    </button>
  );
}

// ── Main game component ────────────────────────────────────────────────────────

export default function ActordleGame({ names }: { names: string[] }) {
  const [input, setInput] = useState("");
  const [filtered, setFiltered] = useState<string[]>([]);
  const [guesses, setGuesses] = useState<ActorComparison[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);
  const [givenUp, setGivenUp] = useState(false);
  const [answer, setAnswer] = useState<{ name: string; imageUrl: string | null } | null>(null);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const guessedNames = new Set(guesses.map((g) => g.name));
  const remaining = MAX_GUESSES - guesses.length;
  const lost = !won && remaining === 0;
  const gameOver = lost || givenUp;

  // Fetch the answer when the game ends (loss or give-up)
  useEffect(() => {
    if (gameOver && !won && !answer) {
      startTransition(async () => {
        const ans = await getActordleAnswer();
        setAnswer(ans);
      });
    }
  }, [gameOver, won, answer]);

  function handleInput(val: string) {
    setInput(val);
    setError(null);
    if (!val.trim()) { setFiltered([]); return; }
    setFiltered(
      names
        .filter((n) => n.toLowerCase().includes(val.toLowerCase()) && !guessedNames.has(n))
        .slice(0, 8)
    );
  }

  function selectSuggestion(name: string) {
    setInput(name);
    setFiltered([]);
    inputRef.current?.focus();
  }

  function handleSubmit() {
    const name = input.trim();
    if (!name || won || gameOver) return;
    if (guessedNames.has(name)) { setError("Already guessed."); return; }

    startTransition(async () => {
      const result = await submitActorGuess(name);
      if ("error" in result) { setError(result.error); return; }
      setGuesses((prev) => [result, ...prev]);
      setInput("");
      setFiltered([]);
      if (result.isCorrect) setWon(true);
    });
  }

  function handleGiveUp() {
    if (won || gameOver) return;
    setGivenUp(true);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 px-4 py-10">

        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-white">🎬 Actordle</h1>
          <p className="text-zinc-400 mt-1.5 text-sm">
            Guess the mystery actor —{" "}
            <span className="text-zinc-300 font-medium">
              {remaining} guess{remaining !== 1 ? "es" : ""} remaining
            </span>
          </p>
          <a href="/" className="text-zinc-600 hover:text-zinc-400 text-xs mt-1 inline-block transition-colors">
            ← All games
          </a>
        </div>

        {!won && !gameOver && (
          <div className="flex flex-col gap-2">
            <div className="flex justify-center">
              <button
                onClick={handleGiveUp}
                className="bg-zinc-800 hover:bg-zinc-700 border border-zinc-600 text-zinc-400 hover:text-zinc-200 text-sm font-semibold px-5 py-2 rounded-lg transition-colors"
              >
                Give Up
              </button>
            </div>

            <div className="relative flex flex-col gap-2">
              <div className="flex gap-2">
                <input
                  ref={inputRef}
                  className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                  placeholder="Type an actor name…"
                  value={input}
                  onChange={(e) => handleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSubmit();
                    if (e.key === "Escape") setFiltered([]);
                  }}
                  disabled={isPending}
                  autoComplete="off"
                />
                <button
                  onClick={handleSubmit}
                  disabled={isPending || !input.trim()}
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-xl transition-colors text-sm"
                >
                  {isPending ? "…" : "Guess"}
                </button>
              </div>

              {filtered.length > 0 && (
                <ul className="absolute top-full mt-1 left-0 right-[5.5rem] z-10 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl overflow-hidden">
                  {filtered.map((n) => (
                    <li
                      key={n}
                      className="px-4 py-2.5 cursor-pointer hover:bg-zinc-700 text-sm text-zinc-100 transition-colors"
                      onMouseDown={() => selectSuggestion(n)}
                    >
                      {n}
                    </li>
                  ))}
                </ul>
              )}

              {error && <p className="text-red-400 text-sm pl-1">{error}</p>}
            </div>
          </div>
        )}

        {won && (
          <div className="text-center bg-green-950 border border-green-700 rounded-xl p-6">
            <p className="text-2xl font-black text-green-400">You got it!</p>
            <p className="text-green-500 mt-1 text-sm">
              {guesses.length === 1 ? "First try!" : `Solved in ${guesses.length} guesses.`}
            </p>
            <ShareButton guesses={guesses} won={true} />
          </div>
        )}

        {!won && gameOver && (
          <div className="text-center bg-red-950 border border-red-800 rounded-xl p-6">
            <p className="text-2xl font-black text-red-400">
              {givenUp ? "You gave up!" : "Better luck tomorrow!"}
            </p>
            <p className="text-red-500 mt-1 text-sm">
              {givenUp
                ? `You gave up after ${guesses.length} guess${guesses.length !== 1 ? "es" : ""}.`
                : `You used all ${MAX_GUESSES} guesses.`}
            </p>
            {answer ? (
              <AnswerReveal name={answer.name} imageUrl={answer.imageUrl} />
            ) : (
              <p className="text-zinc-500 text-sm mt-4 animate-pulse">Revealing answer…</p>
            )}
            <ShareButton guesses={guesses} won={false} />
          </div>
        )}

        {guesses.length > 0 && (
          <div className="flex flex-col gap-3">
            {guesses.map((g, i) => (
              <ActorCard key={`${g.name}-${i}`} row={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
