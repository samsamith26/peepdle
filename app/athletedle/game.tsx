"use client";

import { useState, useRef, useTransition } from "react";
import { submitAthleteGuess } from "./actions";
import type { AthleteComparison } from "@/lib/athleteGame";
import type { Closeness, Direction } from "@/lib/compare";

const MAX_GUESSES = 10;
const EPOCH = new Date("2025-01-01").getTime();
const DAY = Math.floor((Date.now() - EPOCH) / 86_400_000) + 1;

const cmToFtIn = (cm: number): string => {
  const totalIn = Math.round(cm / 2.54);
  return `${Math.floor(totalIn / 12)}'${totalIn % 12}"`;
};

// ── Emoji share helpers ────────────────────────────────────────────────────────

function closenessEmoji(c: Closeness): string {
  return c === "exact" ? "🟩" : c === "close" ? "🟨" : "⬜";
}

function boolEmoji(match: boolean): string {
  return match ? "🟩" : "⬜";
}

function guessRow(g: AthleteComparison): string {
  return [
    closenessEmoji(g.age.closeness),
    closenessEmoji(g.heightCm.closeness),
    boolEmoji(g.sport.match),
    boolEmoji(g.team.match),
    closenessEmoji(g.yearsActive.closeness),
    boolEmoji(g.position.match),
    closenessEmoji(g.allStarSelections.closeness),
  ].join("");
}

// ── Tile component ─────────────────────────────────────────────────────────────
// wrap=true: value text wraps to a second line (used for Team only).
// Default: value is single-line with truncation.

type TileProps = {
  label: string;
  value: string;
  className?: string;
  wrap?: boolean;
} & (
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

// ── Avatar ─────────────────────────────────────────────────────────────────────

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
        <img
          src={src}
          alt={name}
          className="w-full h-full object-cover object-top"
          onError={() => setErr(true)}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-3xl font-black text-zinc-400 select-none">
          {name[0]}
        </div>
      )}
    </div>
  );
}

// ── Guess card ─────────────────────────────────────────────────────────────────
//
// Grid visual:
//   ┌──────────┬──────────────────────────────┬──────────┐
//   │  Age     │  Sport       │  Yrs Active   │          │
//   │          ├────────────────────────────── │  Team   │
//   │  Height  │  Position (wide) │ All-Stars  │ (wrap)  │
//   └──────────┴──────────────────────────────┴──────────┘
//
// Implemented with nested flex, not CSS grid, so that the middle section's
// top and bottom rows can have independent (non-aligned) column boundaries.

function AthleteCard({ row }: { row: AthleteComparison }) {
  return (
    <div
      className={`flex gap-4 items-start rounded-xl border ${
        row.isCorrect ? "border-green-500" : "border-zinc-700"
      } bg-zinc-800/80 p-4`}
    >
      <Avatar src={row.imageUrl} name={row.name} isCorrect={row.isCorrect} />

      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <p className="font-bold text-white text-base leading-tight">{row.name}</p>

        <div className="flex gap-1.5 items-stretch">

          {/* Col 1: Age (top) + Height (bottom) — equal height stacked pair */}
          <div className="flex-1 flex flex-col gap-1.5">
            <Tile kind="num" label="Age"    value={String(row.age.value)}      direction={row.age.direction}    closeness={row.age.closeness}    className="flex-1" />
            <Tile kind="num" label="Height" value={cmToFtIn(row.heightCm.value)} direction={row.heightCm.direction} closeness={row.heightCm.closeness} className="flex-1" />
          </div>

          {/* Middle: two independent rows — top even, bottom uneven */}
          <div className="flex-[2] flex flex-col gap-1.5">
            {/* Top row: Sport + Yrs Active, equal widths */}
            <div className="flex gap-1.5 flex-1">
              <Tile kind="bool" label="Sport"      value={row.sport.value}                    match={row.sport.match}                                                                  className="flex-1" />
              <Tile kind="num"  label="Yrs Active" value={String(row.yearsActive.value)}      direction={row.yearsActive.direction}       closeness={row.yearsActive.closeness}       className="flex-1" />
            </div>
            {/* Bottom row: Position (wider) + All-Stars (narrower) */}
            <div className="flex gap-1.5 flex-1">
              <Tile kind="bool" label="Position"   value={row.position.value}                 match={row.position.match}                                                               className="flex-[3]" />
              <Tile kind="num"  label="All-Stars"  value={String(row.allStarSelections.value)} direction={row.allStarSelections.direction} closeness={row.allStarSelections.closeness} className="flex-[2]" />
            </div>
          </div>

          {/* Col 4: Team — spans full row height, value may wrap */}
          <div className="flex-1 flex flex-col">
            <Tile kind="bool" label="Team" value={row.team.value} match={row.team.match} className="flex-1" wrap />
          </div>

        </div>
      </div>
    </div>
  );
}

// ── Share button ───────────────────────────────────────────────────────────────

function ShareButton({ guesses, won }: { guesses: AthleteComparison[]; won: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleShare() {
    const chronological = [...guesses].reverse();
    const grid = chronological.map(guessRow).join("\n");
    const result = won ? `${guesses.length}/10` : "X/10";
    const text = `🏆 Athletedle — Day ${DAY}\n${result}\n\n${grid}`;
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

export default function AthletedleGame({ names }: { names: string[] }) {
  const [input, setInput] = useState("");
  const [filtered, setFiltered] = useState<string[]>([]);
  const [guesses, setGuesses] = useState<AthleteComparison[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [won, setWon] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const guessedNames = new Set(guesses.map((g) => g.name));
  const remaining = MAX_GUESSES - guesses.length;
  const lost = !won && remaining === 0;

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
    if (!name || won || lost) return;
    if (guessedNames.has(name)) { setError("Already guessed."); return; }

    startTransition(async () => {
      const result = await submitAthleteGuess(name);
      if ("error" in result) { setError(result.error); return; }
      setGuesses((prev) => [result, ...prev]);
      setInput("");
      setFiltered([]);
      if (result.isCorrect) setWon(true);
    });
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="w-full max-w-2xl mx-auto flex flex-col gap-6 px-4 py-10">

        <div className="text-center">
          <h1 className="text-4xl font-black tracking-tight text-white">🏆 Athletedle</h1>
          <p className="text-zinc-400 mt-1.5 text-sm">
            Guess the mystery athlete —{" "}
            <span className="text-zinc-300 font-medium">
              {remaining} guess{remaining !== 1 ? "es" : ""} remaining
            </span>
          </p>
          <a href="/" className="text-zinc-600 hover:text-zinc-400 text-xs mt-1 inline-block transition-colors">
            ← All games
          </a>
        </div>

        {!won && !lost && (
          <div className="relative flex flex-col gap-2">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-white placeholder:text-zinc-500 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all"
                placeholder="Type an athlete name…"
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

        {lost && (
          <div className="text-center bg-red-950 border border-red-800 rounded-xl p-6">
            <p className="text-2xl font-black text-red-400">Better luck tomorrow!</p>
            <p className="text-red-500 mt-1 text-sm">You used all {MAX_GUESSES} guesses.</p>
            <ShareButton guesses={guesses} won={false} />
          </div>
        )}

        {guesses.length > 0 && (
          <div className="flex flex-col gap-3">
            {guesses.map((g, i) => (
              <AthleteCard key={`${g.name}-${i}`} row={g} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
