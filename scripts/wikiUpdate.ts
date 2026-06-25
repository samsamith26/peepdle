/**
 * wikiUpdate.ts
 *
 * Switches data-sourcing from Wikidata SPARQL to Wikipedia articles.
 * Reads each person's actual Wikipedia article and extracts fields from the
 * infobox + article text, the same way a human researcher would.
 *
 * Athletes — updates:  height, position, team (longest tenure),
 *                      yearsActive (career_start → career_end / death),
 *                      allStarSelections (nba_all_star, probowls, etc.)
 *
 * Actors   — updates:  birthYear, nationality, yearsActive (years_active field),
 *                      majorAwards (Oscar/Globe wins counted from article),
 *                      director (most-frequent from filmography table)
 *
 * Fields NOT in Wikipedia (totalCareerGross, avgCriticScore, collaborator
 * images) are left unchanged and flagged in the output.
 *
 * Run:
 *   DATABASE_URL=... npx tsx scripts/wikiUpdate.ts
 *   DATABASE_URL=... npx tsx scripts/wikiUpdate.ts --dry-run
 *   DATABASE_URL=... npx tsx scripts/wikiUpdate.ts --athletes-only
 *   DATABASE_URL=... npx tsx scripts/wikiUpdate.ts --actors-only
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { getTeamLogo, getCanonicalTeamName, isKnownProfessionalTeam } from "@/lib/teamLogos";

const prisma = new PrismaClient({ adapter: new PrismaPg(process.env.DATABASE_URL!) });
const UA = "celebridle-wikiupdate/1.0 (samuel.smith2204@gmail.com)";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const CURRENT_YEAR = 2026;

const DRY_RUN    = process.argv.includes("--dry-run");
const ATHLETES_ONLY = process.argv.includes("--athletes-only");
const ACTORS_ONLY   = process.argv.includes("--actors-only");
const VERBOSE    = process.argv.includes("--verbose");

// ── Wikipedia REST + Action API ───────────────────────────────────────────────

async function fetchJson(url: string): Promise<any | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(attempt * 4000);
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 429) { await sleep(30_000); continue; }
      if (!res.ok) return null;
      return await res.json();
    } catch { /* retry */ }
  }
  return null;
}

/** Wikipedia REST summary for a page title. Returns null if not found / disambiguation. */
async function getSummary(title: string): Promise<{ title: string; description: string; extract: string; imageUrl?: string } | null> {
  const data = await fetchJson(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
  );
  if (!data || data.type === "disambiguation" || data.type === "no-extract") return null;
  return {
    title: data.title as string,
    description: (data.description ?? "") as string,
    extract: (data.extract ?? "") as string,
    imageUrl: (data.thumbnail?.source ?? undefined) as string | undefined,
  };
}

/** Full wikitext for a page title via the MediaWiki Action API. */
async function getWikitext(title: string): Promise<string | null> {
  const data = await fetchJson(
    `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&format=json&titles=${encodeURIComponent(title)}`
  );
  if (!data) return null;
  const pages = Object.values(data?.query?.pages ?? {}) as any[];
  if (!pages.length || pages[0]?.missing) return null;
  return (pages[0]?.revisions?.[0]?.slots?.main?.["*"] ?? null) as string | null;
}

// Disambiguation context suffixes per sport
const SPORT_SUFFIX: Record<string, string> = {
  NBA: " (basketball player)",
  NFL: " (American football player)",
  MLB: " (baseball player)",
  NHL: " (ice hockey player)",
};

/**
 * Find the correct Wikipedia page for a person.
 * Tries the bare name first, then a context suffix if disambiguation or wrong person.
 */
async function findPage(
  name: string,
  type: "actor" | "athlete",
  sport?: string
): Promise<{ title: string; wikiUrl: string; wikitext: string; description: string; extract: string; thumbUrl?: string } | null> {
  const candidates =
    type === "actor"
      ? [name, `${name} (actor)`, `${name} (actress)`, `${name} (film director)`]
      : [name, sport && SPORT_SUFFIX[sport] ? `${name}${SPORT_SUFFIX[sport]}` : name];

  const uniqueCandidates = [...new Set(candidates)];

  for (const candidate of uniqueCandidates) {
    await sleep(250);
    const summary = await getSummary(candidate);
    if (!summary) continue;

    // Quick sanity check: does the description/extract match the expected type?
    const combined = (summary.description + " " + summary.extract.slice(0, 400)).toLowerCase();
    const isActor    = combined.includes("actor") || combined.includes("actress") || combined.includes("director") || combined.includes("film") || combined.includes("television");
    const isAthlete  = combined.includes("basketball") || combined.includes("football") || combined.includes("baseball") || combined.includes("hockey") || combined.includes("player") || combined.includes("athlete");

    if (type === "actor"   && !isActor  ) continue;
    if (type === "athlete" && !isAthlete) continue;

    await sleep(300);
    const wikitext = await getWikitext(summary.title);
    if (!wikitext) continue;

    return {
      title: summary.title,
      wikiUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(summary.title.replace(/ /g, "_"))}`,
      wikitext,
      description: summary.description,
      extract: summary.extract,
      thumbUrl: summary.imageUrl,
    };
  }
  return null;
}

// ── Infobox parser (brace-counting to handle nested templates) ────────────────

/**
 * Returns a Map of lowercase field name → raw value string.
 * Multi-line values (e.g., pastteams bullet lists) are preserved.
 */
function parseInfobox(wikitext: string): Map<string, string> {
  const fields = new Map<string, string>();

  // Locate start of first {{Infobox ...}} block
  const startIdx = wikitext.search(/\{\{Infobox\s/i);
  if (startIdx === -1) return fields;

  // Walk forward counting {{ / }} depth to find the matching close
  let depth = 0;
  let endIdx = startIdx;
  for (let i = startIdx; i < wikitext.length - 1; i++) {
    if (wikitext[i] === "{" && wikitext[i + 1] === "{") { depth++; i++; }
    else if (wikitext[i] === "}" && wikitext[i + 1] === "}") {
      depth--;
      if (depth === 0) { endIdx = i + 2; break; }
      i++;
    }
  }

  const infobox = wikitext.slice(startIdx, endIdx);

  // Parse field lines: | key = value (possibly spanning multiple lines)
  let currentKey = "";
  let currentVal = "";

  const flush = () => {
    if (currentKey) fields.set(currentKey.toLowerCase().trim(), currentVal.trim());
  };

  for (const rawLine of infobox.split("\n")) {
    const line = rawLine; // preserve indent for multi-line detection
    const match = line.match(/^\|\s*([\w\s]+?)\s*=\s*(.*)/);
    if (match) {
      flush();
      currentKey = match[1].trim();
      currentVal = match[2];
    } else if (currentKey && (line.startsWith(" ") || line.startsWith("\t") || line.startsWith("*") || line.startsWith("|") )) {
      currentVal += "\n" + line;
    }
  }
  flush();

  return fields;
}

// ── Generic value cleaners ────────────────────────────────────────────────────

/** Strip wiki markup: [[Link|Label]] → Label, {{Template|Val}} → Val, HTML → "" */
function clean(val: string): string {
  // Handle templates: extract the last pipe-delimited argument (the display text).
  // Annotation/footnote templates (efn, refn, note, sfn, etc.) are stripped entirely.
  const cleanTemplates = (s: string): string =>
    s.replace(/\{\{([^{}]*)\}\}/g, (_, inner) => {
      const parts = inner.split("|");
      const name = parts[0].trim().toLowerCase();
      // Strip footnote/annotation templates entirely instead of extracting content
      if (/^(efn|refn|ref|note|footnote|sfn|harv|harvnb|cn|citation needed|efn-ua|notelist)/i.test(name)) return "";
      return parts.length > 1 ? parts[parts.length - 1].trim() : "";
    });

  // Repeat twice to handle one level of nesting
  let result = cleanTemplates(cleanTemplates(val));

  return result
    .replace(/\[\[([^\]|]*)\|([^\]]*)\]\]/g, "$2")  // [[X|Y]] → Y
    .replace(/\[\[([^\]]*)\]\]/g, "$1")              // [[X]] → X
    .replace(/\[\[|\]\]/g, "")                       // strip any remaining unmatched [[ or ]]
    .replace(/<br\s*\/?>/gi, "\n")                   // <br/> → newline
    .replace(/<ref[^>]*>.*?<\/ref>/gi, "")           // <ref>...</ref> → ""
    .replace(/<[^>]+>/g, "")                         // other tags → ""
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .trim();
}

/** Extract the first 4-digit year from a wiki date template or plain string. */
function extractYear(val: string | undefined): number | null {
  if (!val) return null;
  // {{birth date and age|YYYY|...}} or {{death date...|YYYY|...}}
  const tmpl = val.match(/\{\{(?:birth|death)[^|]*\|(\d{4})/i);
  if (tmpl) return parseInt(tmpl[1], 10);
  // {{birth-date|Month DD, YYYY}} or similar
  const bd = val.match(/\{\{birth-?date[^|]*?\|[^}]*?(\d{4})/i);
  if (bd) return parseInt(bd[1], 10);
  // Plain "YYYY" anywhere in value
  const plain = val.match(/\b(1[6-9]\d{2}|20[012]\d)\b/);
  if (plain) return parseInt(plain[1], 10);
  return null;
}

/** Convert height_ft + height_in strings to centimetres. */
function toCm(ft: string | undefined, inches: string | undefined): number | null {
  const f = parseFloat(ft?.match(/\d+\.?\d*/)?.[0] ?? "0");
  const i = parseFloat(inches?.match(/\d+\.?\d*/)?.[0] ?? "0");
  if (!f) return null;
  return Math.round((f * 12 + i) * 2.54);
}

// ── yearsActive extraction ────────────────────────────────────────────────────

function extractYearsActive(fields: Map<string, string>): number | null {
  // 1. years_active / yearsactive / career: "YYYY–present" or "YYYY–YYYY"
  const ya = fields.get("years_active") ?? fields.get("yearsactive") ?? fields.get("career") ?? "";
  if (ya) {
    const m = ya.match(/(\d{4})\s*[–—-]\s*(present|\d{4})?/i);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] && !/present/i.test(m[2]) ? parseInt(m[2], 10) : null;
      // If end is not "present", also check death_date
      const deathYear = extractYear(fields.get("death_date") ?? fields.get("deathdate"));
      const effectiveEnd = end ?? deathYear ?? CURRENT_YEAR;
      const span = effectiveEnd - start;
      if (span >= 1 && span <= 80) return span;
    }
  }

  // 2. career_start / career_end (athletes)
  const careerStart = extractYear(
    fields.get("career_start") ?? fields.get("careerfrom") ?? fields.get("debutyear") ??
    fields.get("career_start_year") ?? fields.get("nfl_start_year")
  );
  const careerEnd = extractYear(
    fields.get("career_end") ?? fields.get("careerto") ?? fields.get("finalyear") ??
    fields.get("career_end_year") ?? fields.get("nfl_end_year")
  );
  const deathYear = extractYear(fields.get("death_date") ?? fields.get("deathdate"));

  if (careerStart) {
    const effectiveEnd = careerEnd ?? deathYear ?? CURRENT_YEAR;
    const span = effectiveEnd - careerStart;
    if (span >= 1 && span <= 60) return span;
  }

  return null;
}

// ── Nationality extraction ────────────────────────────────────────────────────

const COUNTRY_PATTERNS: [RegExp, string][] = [
  [/\bUnited States\b|\bU\.S\.?\b|\bAmerica\b/i,     "United States"],
  [/\bUnited Kingdom\b|\bEngland\b|\bBritish\b/i,     "United Kingdom"],
  [/\bCanada\b|\bCanadian\b/i,                         "Canada"],
  [/\bAustralia\b|\bAustralian\b/i,                    "Australia"],
  [/\bFrance\b|\bFrench\b/i,                           "France"],
  [/\bGermany\b|\bGerman\b/i,                          "Germany"],
  [/\bBrazil\b|\bBrazilian\b/i,                        "Brazil"],
  [/\bArgentina\b|\bArgentinian\b/i,                   "Argentina"],
  [/\bSpain\b|\bSpanish\b/i,                           "Spain"],
  [/\bItaly\b|\bItalian\b/i,                           "Italy"],
  [/\bNigeria\b|\bNigerian\b/i,                        "Nigeria"],
  [/\bCroatia\b|\bCroatian\b/i,                        "Croatia"],
  [/\bLithuania\b|\bLithuanian\b/i,                    "Lithuania"],
  [/\bSlovenia\b|\bSlovenian\b/i,                      "Slovenia"],
  [/\bSerbia\b|\bSerbian\b/i,                           "Serbia"],
  [/\bLatvia\b|\bLatvian\b/i,                           "Latvia"],
  [/\bGreece\b|\bGreek\b/i,                             "Greece"],
  [/\bTurkey\b|\bTurkish\b/i,                           "Turkey"],
  [/\bCzech\b/i,                                        "Czech Republic"],
  [/\bNew Zealand\b/i,                                  "New Zealand"],
  [/\bIreland\b|\bIrish\b/i,                            "Ireland"],
  [/\bSouth Africa\b/i,                                 "South Africa"],
  [/\bJamaica\b|\bJamaican\b/i,                         "Jamaica"],
  [/\bPuerto Rico\b/i,                                  "Puerto Rico"],
  [/\bCameroon\b|\bCameroonian\b/i,                     "Cameroon"],
  [/\bSenegal\b|\bSenegalese\b/i,                       "Senegal"],
  [/\bMali\b|\bMalian\b/i,                              "Mali"],
  [/\bCongo\b|\bCongolese\b/i,                          "Democratic Republic of the Congo"],
  [/\bCôte d'Ivoire\b|\bIvory Coast\b|\bIvorian\b/i,   "Ivory Coast"],
  [/\bChina\b|\bChinese\b/i,                            "China"],
  [/\bSudan\b|\bSudanese\b/i,                           "Sudan"],
  [/\bBenin\b/i,                                        "Benin"],
  [/\bSweden\b|\bSwedish\b/i,                           "Sweden"],
  [/\bFinland\b|\bFinnish\b/i,                          "Finland"],
  [/\bNorway\b|\bNorwegian\b/i,                         "Norway"],
  [/\bNetherlands\b|\bDutch\b/i,                        "Netherlands"],
  [/\bBelgium\b|\bBelgian\b/i,                          "Belgium"],
  [/\bRussia\b|\bRussian\b/i,                            "Russia"],
  [/\bPoland\b|\bPolish\b/i,                             "Poland"],
  [/\bMexico\b|\bMexican\b/i,                            "Mexico"],
  [/\bCuba\b|\bCuban\b/i,                                "Cuba"],
  [/\bVenezuela\b|\bVenezuelan\b/i,                      "Venezuela"],
  [/\bDominican Republic\b/i,                            "Dominican Republic"],
  [/\bPanama\b|\bPanamanian\b/i,                         "Panama"],
];

function extractNationality(fields: Map<string, string>, extract: string): string | null {
  // 1. nationality field
  const natField = fields.get("nationality") ?? "";
  if (natField) {
    const c = clean(natField);
    for (const [pat, name] of COUNTRY_PATTERNS) {
      if (pat.test(c)) return name;
    }
  }

  // 2. birth_place: "City, State, Country" → try last part then full string
  const bp = clean(fields.get("birth_place") ?? fields.get("birthplace") ?? "");
  if (bp) {
    const parts = bp.split(",").map((p) => p.trim()).reverse();
    for (const part of parts) {
      for (const [pat, name] of COUNTRY_PATTERNS) {
        if (pat.test(part)) return name;
      }
    }
  }

  // 3. Lead-sentence: "is an American actor" etc.
  for (const [pat, name] of COUNTRY_PATTERNS) {
    if (pat.test(extract.slice(0, 300))) return name;
  }

  return null;
}

// ── All-Star count extraction ─────────────────────────────────────────────────

const ALL_STAR_INFOBOX_KEYS: Record<string, string[]> = {
  NBA: ["nba_allstar", "nba_all_star", "allstar"],
  NFL: ["probowls", "pro_bowls", "proselections", "pro_bowl", "allpro"],
  MLB: ["mlb_allstar", "mlb_all_star", "allstar_total"],
  NHL: ["nhl_allstar", "nhl_all_star", "allstar"],
};

// Text patterns: tight enough to avoid false positives.
// Require "N-time" (hyphenated) or "N times" in clear All-Star/Pro Bowl selection contexts.
const ALL_STAR_TEXT_PATTERNS: Record<string, RegExp[]> = {
  NBA: [
    /(\d{1,2})-time NBA All-Star/i,                                 // "20-time NBA All-Star"
    /(\d{1,2})×\s*NBA All-Star/i,                                   // "20× NBA All-Star"
    /NBA All-Star (?:selections?|appearances?):\s*(\d{1,2})/i,      // "NBA All-Star selections: 20"
    /selected to (?:the )?NBA All-Star(?:\s+Game)? (\d{1,2}) times?/i, // with or without "the"
    /selected (?:as|to) (\d{1,2}) NBA All-Star/i,                   // "selected to 21 NBA All-Star"
    /(\d{1,2}) NBA All-Star (?:selections?|appearances?)/i,          // "21 NBA All-Star selections"
  ],
  NFL: [
    /(\d{1,2})-time Pro Bowl/i,                            // "15-time Pro Bowl"
    /(\d{1,2})×\s*Pro Bowl/i,
    /Pro Bowl (?:selections?|appearances?):\s*(\d{1,2})/i,
    /selected to (\d{1,2}) Pro Bowls?/i,
    /(\d{1,2}) Pro Bowl selections?/i,
  ],
  MLB: [
    /(\d{1,2})-time (?:MLB )?All-Star/i,
    /All-Star (?:selections?|appearances?):\s*(\d{1,2})/i,
    /selected to (\d{1,2}) All-Star Games?/i,
  ],
  NHL: [
    /(\d{1,2})-time (?:NHL )?All-Star/i,
    /All-Star (?:selections?|appearances?):\s*(\d{1,2})/i,
  ],
};

function extractAllStars(fields: Map<string, string>, sport: string, wikitext: string): number {
  // 1. Infobox field
  for (const key of ALL_STAR_INFOBOX_KEYS[sport] ?? []) {
    const v = fields.get(key) ?? "";
    if (!v) continue;
    const n = parseInt(v.match(/\d+/)?.[0] ?? "0", 10);
    if (n > 0 && n <= 30) return n;
  }

  // 2. Article text patterns (first 15 000 chars covers intro + career summary)
  const searchText = wikitext.slice(0, 15_000);
  for (const pat of ALL_STAR_TEXT_PATTERNS[sport] ?? []) {
    const m = searchText.match(pat);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n <= 30) return n;
    }
  }

  return 0;
}

// ── Team extraction ───────────────────────────────────────────────────────────

interface RawTeamEntry { name: string; start: number; end: number; isCurrent: boolean }

/** Strip franchise relocation slash: "Minneapolis / Los Angeles Lakers" → "Los Angeles Lakers" */
function normalizeTeamName(raw: string): string {
  // Strip trailing slash (franchise move where second team is on next line, now consumed)
  let name = raw.replace(/\s*\/\s*$/, "").trim();
  // Handle "Team1 / Team2" (spaced) notation — take the last (most recent) team
  if (name.includes(" / ")) return name.split(" / ").pop()!.trim();
  // Handle "Team1/Team2" (no spaces) notation — take the last team
  if (name.includes("/")) return name.split("/").pop()!.trim();
  return name;
}

function parseRawYear(rawYears: string): { start: number; end: number; isCurrent: boolean } {
  const ym = rawYears.match(/(\d{4})\s*[–—-]\s*(present|\d{4})?/i);
  const isCurrent = ym !== null && (!ym[2] || /present/i.test(ym[2]));
  const start     = ym ? parseInt(ym[1], 10) : 0;
  const end       = isCurrent ? CURRENT_YEAR : (ym && ym[2] ? parseInt(ym[2], 10) : 0);
  return { start, end, isCurrent };
}

/**
 * Parse all team stints from the Wikipedia infobox.
 * Handles both NBA-style (team1/years1) and NFL-style (pastteams bullet list).
 * Filters to known major-league professional teams only (blocks European clubs,
 * minor leagues, and non-playing roles via the teamLogos whitelist).
 */
function parseTeamEntries(fields: Map<string, string>): RawTeamEntry[] {
  const entries: RawTeamEntry[] = [];

  // ── NBA-style: team1/years1 … team8/years8 ──────────────────────────────
  for (let i = 1; i <= 10; i++) {
    const rawTeam  = fields.get(`team${i}`) ?? fields.get(`team_${i}`) ?? "";
    const rawYears = fields.get(`years${i}`) ?? fields.get(`years_span${i}`) ?? fields.get(`year${i}`) ?? "";
    if (!rawTeam) break;

    // Join lines that end with / (e.g. "SuperSonics/\nOKC" = same franchise)
    const rawCleaned = clean(rawTeam).replace(/\/\s*\n\s*/g, "/");
    const rawName = normalizeTeamName(rawCleaned.split(/\n/)[0].split(/\s*\(/)[0].trim());
    if (!rawName || /retired|inactive|free agent/i.test(rawName)) continue;
    const canonical = getCanonicalTeamName(rawName);
    if (!canonical) continue;  // filter out European/minor/amateur teams

    const { start, end, isCurrent } = parseRawYear(rawYears);
    entries.push({ name: canonical, start, end, isCurrent });
  }

  if (entries.length > 0) return entries;

  // ── NFL-style: currentteam + pastteams bullet list ───────────────────────
  const rawCurrent = normalizeTeamName(clean(fields.get("currentteam") ?? "").split(/\n/)[0].trim());
  const canonicalCurrent = rawCurrent ? getCanonicalTeamName(rawCurrent) : null;
  if (canonicalCurrent && !/retired|free agent|unsigned/i.test(rawCurrent)) {
    entries.push({ name: canonicalCurrent, start: 0, end: CURRENT_YEAR, isCurrent: true });
  }

  const past = fields.get("pastteams") ?? fields.get("career_team") ?? "";
  for (const line of past.split(/\n/)) {
    const stripped = line.replace(/^\s*\*\s*/, "").trim();
    if (!stripped) continue;
    const rawName = normalizeTeamName(clean(stripped.replace(/\s*\([\d–\-–present]+\).*/i, "")).split(/\s*\(/)[0].trim());
    if (!rawName || /retired|free agent/i.test(rawName)) continue;
    const canonical = getCanonicalTeamName(rawName);
    if (!canonical) continue;
    const { start, end, isCurrent } = parseRawYear(stripped.match(/\((\d{4}[^)]*)\)/)?.[1] ?? "");
    entries.push({ name: canonical, start, end, isCurrent });
  }

  return entries;
}

/**
 * Returns up to `n` teams for storage in the DB, ordered by:
 *   1. Current team (most recently started) first
 *   2. Retired teams by total career years (longest stints per franchise)
 */
function extractTopTeams(
  fields: Map<string, string>,
  n = 3
): Array<{ name: string; logoUrl: string | null }> {
  const entries = parseTeamEntries(fields);
  if (!entries.length) return [];

  // Aggregate: sum all stints per normalised team name
  type Agg = { logoUrl: string | null; totalYears: number; isCurrent: boolean; latestStart: number };
  const agg = new Map<string, Agg>();

  for (const e of entries) {
    const existing = agg.get(e.name) ?? {
      logoUrl: getTeamLogo(e.name),
      totalYears: 0,
      isCurrent: false,
      latestStart: 0,
    };
    existing.totalYears += e.end - e.start;
    if (e.isCurrent) {
      existing.isCurrent = true;
      existing.latestStart = Math.max(existing.latestStart, e.start);
    }
    agg.set(e.name, existing);
  }

  return [...agg.entries()]
    .sort(([, a], [, b]) => {
      // Current teams come first, sorted by most-recently-started
      if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
      if (a.isCurrent && b.isCurrent) return b.latestStart - a.latestStart;
      // Retired: sort by total career years
      return b.totalYears - a.totalYears;
    })
    .slice(0, n)
    .map(([name, data]) => ({ name, logoUrl: data.logoUrl }));
}

/** Best single team (primary affiliation) — first element of extractTopTeams. */
function extractTeam(fields: Map<string, string>): string | null {
  return extractTopTeams(fields, 1)[0]?.name ?? null;
}

// ── Position extraction ───────────────────────────────────────────────────────

// Known valid sport positions — anything else is likely a role/title, not a position
const KNOWN_POSITIONS = new Set([
  // Basketball
  "point guard","shooting guard","small forward","power forward","center",
  "guard","forward","forward/center","forward/guard","guard/forward",
  // Football
  "quarterback","running back","halfback","fullback","wide receiver","tight end",
  "offensive lineman","offensive tackle","offensive guard","center","defensive end",
  "defensive tackle","linebacker","cornerback","safety","free safety","strong safety",
  "placekicker","punter","defensive back","outside linebacker","inside linebacker",
  // Baseball
  "pitcher","starting pitcher","relief pitcher","catcher","first baseman","second baseman",
  "third baseman","shortstop","left fielder","center fielder","right fielder","outfielder",
  "infielder","designated hitter",
  // Hockey
  "left wing","right wing","centre","center","winger","defenceman","defenseman","goaltender","goalie",
]);

function extractPosition(fields: Map<string, string>): string | null {
  const raw = fields.get("position") ?? fields.get("positions") ?? "";
  if (!raw) return null;

  // Take all comma/slash/newline separated parts, find one matching known positions
  const parts = clean(raw)
    .toLowerCase()
    .replace(/\(.*?\)/g, "")         // remove parenthetical qualifiers
    .split(/[,/·\n|]+/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const part of parts) {
    if (KNOWN_POSITIONS.has(part)) return part;
    // Fuzzy: contains a known keyword
    for (const known of KNOWN_POSITIONS) {
      if (part.includes(known) || known.includes(part)) return known;
    }
  }

  // If nothing matched and raw is short enough, return the first part anyway
  // (might be a valid foreign-language or abbreviated position)
  const fallback = parts[0];
  if (fallback && fallback.length <= 25 && !/consult|executive|president|coach|manager|director|advisor|owner|ambassador|broadcaster|commentator|analyst|partner|board|committee|special assistant|assistant general|general manager|vice president|scout/i.test(fallback)) {
    return fallback;
  }

  return null;
}

// ── Major awards extraction (actors) ─────────────────────────────────────────

function extractMajorAwards(_wikitext: string, extract: string): number {
  // Use the full plain-text extract (not sliced) — raw wikitext uses {{won}} templates
  // that don't contain literal "won Academy Award", so plain text is more reliable
  const words: Record<string, number> = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10 };
  function parseNum(s: string): number { return words[s.toLowerCase()] ?? parseInt(s, 10); }

  // Collect all candidate win counts; return the maximum
  const WIN_PATTERNS: RegExp[] = [
    /(\w+)[- ]time\s+Academy\s+Award[- ]winning/gi,
    /(\w+)[- ]time\s+(?:Oscar|Academy Award)\s+winner/gi,
    /(?:won|earned|received)\s+(\w+)\s+Academy\s+Awards?\b/gi,
    /Academy\s+Award[^.\n]{0,80}?winning\s+(\w+)\b/gi,
    /(\w+)\s+Academy\s+Award\s+wins?\b/gi,
    /won\s+(\w+)\s+Oscars?\b/gi,
    /(\w+)[- ]time\s+Oscar\s+winner/gi,
  ];

  let best = 0;
  for (const pat of WIN_PATTERNS) {
    for (const m of extract.matchAll(pat)) {
      const n = parseNum(m[1]);
      if (n > 0 && n <= 12 && n > best) best = n;
    }
  }
  return best;
}

// ── Director extraction from filmography table ────────────────────────────────

async function extractDirectorFromFilmography(
  wikitext: string,
  actorName: string
): Promise<{ name: string; imageUrl: string | null } | null> {
  // Locate Filmography section
  const filmStart = wikitext.search(/==\s*Filmography\s*==/i);
  if (filmStart === -1) return null;
  const filmEnd = wikitext.indexOf("\n==", filmStart + 5);
  const filmSection = wikitext.slice(filmStart, filmEnd > 0 ? filmEnd : filmStart + 20_000);

  // Find wikitables that have a "Director" header
  const dirCounts = new Map<string, number>();
  const tables = filmSection.split(/(?=\{\|)/g);

  for (const table of tables) {
    if (!table.includes("|")) continue;

    // Find header row
    const headerMatch = table.match(/\|[-!][^\n]*(?:Director|director)[^\n]*/);
    if (!headerMatch) continue;

    // Determine which column index is "Director"
    const headerCells = headerMatch[0]
      .split(/!!/)
      .map((c) => c.replace(/^[|!]+\s*/, "").toLowerCase());
    const dirIdx = headerCells.findIndex((c) => c.includes("director"));
    if (dirIdx === -1) continue;

    // Walk each data row
    for (const rowMatch of table.matchAll(/^\|-[^\n]*\n((?:[^|][^\n]*\n|\|[^\n]*\n)*)/gm)) {
      const rowContent = rowMatch[1];
      // Split cells on || or newline-|
      const cells = rowContent
        .split(/\|\||\n\s*\|(?=[^|}])/)
        .map((c) => c.trim());

      const dirCell = cells[dirIdx] ?? "";
      // Extract [[Person Name]] from director cell
      const link = dirCell.match(/\[\[([^\]|]+)/)?.[1]?.trim();
      if (link && link !== actorName && link.length > 3) {
        dirCounts.set(link, (dirCounts.get(link) ?? 0) + 1);
      }
    }
  }

  if (!dirCounts.size) return null;

  const [topDirector] = [...dirCounts.entries()].sort((a, b) => b[1] - a[1]);
  const dirName = topDirector[0];

  // Fetch the director's Wikipedia thumbnail
  await sleep(250);
  const dirSummary = await getSummary(dirName);
  return {
    name: dirName,
    imageUrl: dirSummary?.imageUrl ?? null,
  };
}

// ── Main processing ───────────────────────────────────────────────────────────

// ── RT Score extraction ───────────────────────────────────────────────────────

function extractRTScore(wikitext: string): number {
  // Search the full article — RT scores typically appear in individual film sections
  // We average all found critic scores as a career approximation
  const scores: number[] = [];
  const seen = new Set<number>();

  const patterns = [
    /(\d{1,3})%\s+(?:approval )?rating on Rotten Tomatoes/gi,
    /(\d{1,3})%\s+on Rotten Tomatoes/gi,
    /Rotten Tomatoes[^.\n]{0,80}?(\d{1,3})%/gi,
    /(\d{1,3})%[^.\n]{0,80}?Rotten Tomatoes/gi,
  ];

  for (const pat of patterns) {
    for (const m of wikitext.matchAll(pat)) {
      const n = parseInt(m[1], 10);
      // Skip audience scores (Rotten Tomatoes audience is usually mentioned near "audience")
      const ctx = wikitext.slice(Math.max(0, m.index! - 60), m.index! + 60);
      if (/audience|popcornmeter/i.test(ctx)) continue;
      if (n >= 0 && n <= 100 && !seen.has(n)) {
        seen.add(n);
        scores.push(n);
      }
    }
  }

  if (!scores.length) return 0;
  // Median to reduce outlier noise from a single poorly-reviewed film
  scores.sort((a, b) => a - b);
  const mid = Math.floor(scores.length / 2);
  return scores.length % 2 === 0
    ? Math.round((scores[mid - 1] + scores[mid]) / 2)
    : scores[mid];
}

// ── Main processing ───────────────────────────────────────────────────────────

async function processAthletes(spotCheck: any[]) {
  const athletes = await prisma.athlete.findMany({
    select: { id: true, name: true, sport: true, team: true, teams: true, position: true, heightCm: true, yearsActive: true, allStarSelections: true, birthYear: true },
    orderBy: { id: "asc" },
  });
  console.log(`\nProcessing ${athletes.length} athletes…\n`);

  let fixed = 0, notFound = 0;

  for (const athlete of athletes) {
    await sleep(350);
    const page = await findPage(athlete.name, "athlete", athlete.sport);

    if (!page) {
      if (VERBOSE) console.log(`  NOT FOUND: ${athlete.name}`);
      notFound++;
      continue;
    }

    const fields = parseInfobox(page.wikitext);

    const newHeight      = toCm(fields.get("height_ft") ?? fields.get("heightft"), fields.get("height_in") ?? fields.get("heightin"));
    const newPosition    = extractPosition(fields);
    const newTeams       = extractTopTeams(fields, 3);
    const newPrimaryTeam = newTeams[0]?.name ?? null;
    const newYearsActive = extractYearsActive(fields);
    const newAllStars    = extractAllStars(fields, athlete.sport, page.wikitext);

    const existingTeams  = athlete.teams as Array<{ name: string; logoUrl: string | null }>;
    const teamsChanged   = newTeams.length > 0 &&
      JSON.stringify(newTeams) !== JSON.stringify(existingTeams);

    const dbUpdate: Record<string, any> = {};
    const changes: string[] = [];
    const flags: string[] = [];

    if (newHeight && newHeight !== athlete.heightCm)                { dbUpdate.heightCm = newHeight;            changes.push(`height: ${athlete.heightCm} → ${newHeight}`); }
    if (newPosition && newPosition !== athlete.position)            { dbUpdate.position = newPosition;          changes.push(`position: ${athlete.position} → ${newPosition}`); }
    if (newPrimaryTeam && newPrimaryTeam !== athlete.team)          { dbUpdate.team = newPrimaryTeam;           changes.push(`team: ${athlete.team} → ${newPrimaryTeam}`); }
    if (teamsChanged)                                               { dbUpdate.teams = newTeams;                changes.push(`teams: [${newTeams.map((t) => t.name).join(", ")}]`); }
    if (newYearsActive && newYearsActive !== athlete.yearsActive)   { dbUpdate.yearsActive = newYearsActive;    changes.push(`yearsActive: ${athlete.yearsActive} → ${newYearsActive}`); }
    // Only update if new value is positive (don't overwrite real data with extraction failure)
    if (newAllStars > 0 && newAllStars !== athlete.allStarSelections) { dbUpdate.allStarSelections = newAllStars; changes.push(`allStars: ${athlete.allStarSelections} → ${newAllStars}`); }

    if (!newHeight)         flags.push("height not in infobox");
    if (!newPosition)       flags.push("position not in infobox");
    if (!newPrimaryTeam)    flags.push("no professional team found");
    if (!newYearsActive)    flags.push("yearsActive not found");

    if (changes.length > 0) {
      console.log(`  ${athlete.name}: ${changes.join(", ")}`);
      if (!DRY_RUN) {
        await prisma.athlete.update({ where: { id: athlete.id }, data: dbUpdate });
        fixed++;
      }
    }
    if (VERBOSE && flags.length) console.log(`    [flags] ${flags.join("; ")}`);

    if (spotCheck.length < 5) {
      spotCheck.push({
        type: "athlete",
        name: athlete.name,
        sport: athlete.sport,
        wikiUrl: page.wikiUrl,
        description: page.description,
        extracted: { height: newHeight, position: newPosition, teams: newTeams.map((t) => t.name), yearsActive: newYearsActive, allStars: newAllStars },
        flags,
      });
    }
  }

  console.log(`\nAthletes: ${fixed} updated, ${notFound} not found on Wikipedia\n`);
}

async function processActors(spotCheck: any[]) {
  const actors = await prisma.actor.findMany({
    select: { id: true, name: true, birthYear: true, deathYear: true, nationality: true, yearsActive: true, majorAwards: true, avgCriticScore: true, director: true },
    orderBy: { id: "asc" },
  });
  console.log(`\nProcessing ${actors.length} actors…\n`);

  let fixed = 0, notFound = 0;

  for (const actor of actors) {
    await sleep(350);
    const page = await findPage(actor.name, "actor");

    if (!page) {
      if (VERBOSE) console.log(`  NOT FOUND: ${actor.name}`);
      notFound++;
      continue;
    }

    const fields = parseInfobox(page.wikitext);

    const newBirthYear   = extractYear(fields.get("birth_date") ?? fields.get("birthdate") ?? fields.get("birth date"));
    const rawDeathYear   = extractYear(fields.get("death_date") ?? fields.get("deathdate") ?? fields.get("death date"));
    const newDeathYear   = rawDeathYear ?? null;
    const newNationality = extractNationality(fields, page.extract);
    const newYearsActive = extractYearsActive(fields);
    const newMajorAwards = extractMajorAwards(page.wikitext, page.extract);
    const newRTScore     = extractRTScore(page.wikitext);

    // Director from filmography
    const existingDirector = actor.director as { name: string; imageUrl: string | null } | null;
    let newDirector: { name: string; imageUrl: string | null } | null = null;
    if (page.wikitext.search(/==\s*Filmography/i) !== -1) {
      newDirector = await extractDirectorFromFilmography(page.wikitext, actor.name);
    }

    const dbUpdate: Record<string, any> = {};
    const changes: string[] = [];
    const flags: string[] = [];

    if (newBirthYear   && newBirthYear   !== actor.birthYear)              { dbUpdate.birthYear    = newBirthYear;    changes.push(`birthYear: ${actor.birthYear} → ${newBirthYear}`); }
    if (newDeathYear   !== null && newDeathYear !== actor.deathYear)       { dbUpdate.deathYear    = newDeathYear;    changes.push(`deathYear: ${actor.deathYear ?? "alive"} → ${newDeathYear}`); }
    if (newNationality && newNationality !== actor.nationality)            { dbUpdate.nationality  = newNationality;  changes.push(`nationality: ${actor.nationality} → ${newNationality}`); }
    if (newYearsActive && newYearsActive !== actor.yearsActive)            { dbUpdate.yearsActive  = newYearsActive;  changes.push(`yearsActive: ${actor.yearsActive} → ${newYearsActive}`); }
    if (newMajorAwards > 0 && newMajorAwards !== actor.majorAwards)       { dbUpdate.majorAwards  = newMajorAwards;  changes.push(`majorAwards: ${actor.majorAwards} → ${newMajorAwards}`); }
    if (newRTScore > 0 && newRTScore !== Math.round(actor.avgCriticScore)) { dbUpdate.avgCriticScore = newRTScore;    changes.push(`rtScore: ${actor.avgCriticScore} → ${newRTScore}`); }
    if (newDirector && newDirector.name !== existingDirector?.name)        {
      dbUpdate.director = newDirector;
      changes.push(`director: ${existingDirector?.name ?? "none"} → ${newDirector.name}`);
    }

    if (!newBirthYear)   flags.push("birthYear not in infobox");
    if (!newNationality) flags.push("nationality not found");
    if (!newYearsActive) flags.push("yearsActive not in infobox");
    if (!newDirector)    flags.push("director: filmography table not parseable");
    if (!newRTScore)     flags.push("RT score not found in article text");

    if (changes.length > 0) {
      console.log(`  ${actor.name}: ${changes.join(", ")}`);
      if (!DRY_RUN) {
        await prisma.actor.update({ where: { id: actor.id }, data: dbUpdate });
        fixed++;
      }
    }
    if (VERBOSE && flags.length) console.log(`    [flags] ${flags.join("; ")}`);

    if (spotCheck.length < 5) {
      spotCheck.push({
        type: "actor",
        name: actor.name,
        wikiUrl: page.wikiUrl,
        description: page.description,
        extracted: {
          birthYear: newBirthYear,
          deathYear: newDeathYear,
          nationality: newNationality,
          yearsActive: newYearsActive,
          majorAwards: newMajorAwards,
          rtScore: newRTScore,
          director: newDirector?.name ?? null,
        },
        flags,
      });
    }
  }

  console.log(`\nActors: ${fixed} updated, ${notFound} not found on Wikipedia\n`);
}

async function main() {
  if (DRY_RUN) console.log("DRY RUN — no DB changes will be written\n");

  const spotCheck: any[] = [];

  if (!ACTORS_ONLY)  await processAthletes(spotCheck);
  if (!ATHLETES_ONLY) await processActors(spotCheck);

  // ── Spot-check output ─────────────────────────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("SPOT-CHECK: first 5 athletes + first 5 actors processed");
  console.log("═══════════════════════════════════════════════════════\n");

  for (const entry of spotCheck) {
    console.log(`${entry.name} (${entry.type === "athlete" ? entry.sport : "actor"})`);
    console.log(`  Wikipedia : ${entry.wikiUrl}`);
    console.log(`  Description: ${entry.description}`);
    console.log(`  Extracted : ${JSON.stringify(entry.extracted)}`);
    const importantFlags = entry.flags.filter(
      (f: string) => !f.includes("not available") && !f.includes("not re-extracted")
    );
    if (importantFlags.length) console.log(`  Flags     : ${importantFlags.join("; ")}`);
    console.log();
  }

  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
