export type Direction = "higher" | "lower" | "match";
export type Closeness = "exact" | "close" | "far";

export type NumericResult = {
  value: number;
  direction: Direction;
  closeness: Closeness;
};

export type BoolResult = {
  value: string;
  match: boolean;
};

export function numericCompare(
  guess: number,
  answer: number,
  isClose: (g: number, a: number) => boolean
): NumericResult {
  const direction: Direction =
    guess === answer ? "match" : answer > guess ? "higher" : "lower";
  const closeness: Closeness =
    guess === answer ? "exact" : isClose(guess, answer) ? "close" : "far";
  return { value: guess, direction, closeness };
}

export function boolCompare(guessVal: string, answerVal: string): BoolResult {
  return { value: guessVal, match: guessVal === answerVal };
}

// Threshold helpers
export const absDiff =
  (threshold: number) =>
  (a: number, b: number) =>
    Math.abs(a - b) <= threshold;

export const pctDiff =
  (threshold: number) =>
  (a: number, b: number) =>
    Math.abs(a - b) / Math.max(Math.abs(b), 1) <= threshold;
