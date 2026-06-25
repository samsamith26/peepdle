/**
 * Maps major professional sports team names to their ESPN CDN logo URLs.
 * This doubles as a whitelist — any team NOT in this map is filtered out
 * (European clubs, minor leagues, amateur teams, etc.).
 */

const BASE = "https://a.espncdn.com/i/teamlogos";

const NBA = `${BASE}/nba/500`;
const NFL = `${BASE}/nfl/500`;
const MLB = `${BASE}/mlb/500`;
const NHL = `${BASE}/nhl/500`;

// Maps lowercase team name → logo URL.
// Includes both current names and historical names for the same franchise.
const TEAM_LOGO_MAP: Record<string, string> = {
  // ── NBA ──────────────────────────────────────────────────────────────────────
  "atlanta hawks":             `${NBA}/atl.png`,
  "boston celtics":            `${NBA}/bos.png`,
  "brooklyn nets":             `${NBA}/bkn.png`,
  "new jersey nets":           `${NBA}/bkn.png`,  // historical
  "charlotte hornets":         `${NBA}/cha.png`,
  "charlotte bobcats":         `${NBA}/cha.png`,  // historical
  "chicago bulls":             `${NBA}/chi.png`,
  "cleveland cavaliers":       `${NBA}/cle.png`,
  "dallas mavericks":          `${NBA}/dal.png`,
  "denver nuggets":            `${NBA}/den.png`,
  "detroit pistons":           `${NBA}/det.png`,
  "golden state warriors":     `${NBA}/gs.png`,
  "houston rockets":           `${NBA}/hou.png`,
  "indiana pacers":            `${NBA}/ind.png`,
  "los angeles clippers":      `${NBA}/lac.png`,
  "los angeles lakers":        `${NBA}/lal.png`,
  "memphis grizzlies":         `${NBA}/mem.png`,
  "vancouver grizzlies":       `${NBA}/mem.png`,  // historical
  "miami heat":                `${NBA}/mia.png`,
  "milwaukee bucks":           `${NBA}/mil.png`,
  "minnesota timberwolves":    `${NBA}/min.png`,
  "new orleans pelicans":      `${NBA}/no.png`,
  "new orleans hornets":       `${NBA}/no.png`,   // historical
  "new york knicks":           `${NBA}/ny.png`,
  "oklahoma city thunder":     `${NBA}/okc.png`,
  "seattle supersonics":       `${NBA}/okc.png`,  // historical (same franchise)
  "orlando magic":             `${NBA}/orl.png`,
  "philadelphia 76ers":        `${NBA}/phi.png`,
  "phoenix suns":              `${NBA}/phx.png`,
  "portland trail blazers":    `${NBA}/por.png`,
  "sacramento kings":          `${NBA}/sac.png`,
  "kansas city kings":         `${NBA}/sac.png`,  // historical
  "cincinnati royals":         `${NBA}/sac.png`,  // historical
  "san antonio spurs":         `${NBA}/sa.png`,
  "toronto raptors":           `${NBA}/tor.png`,
  "utah jazz":                 `${NBA}/utah.png`,
  "new orleans jazz":          `${NBA}/utah.png`, // historical
  "washington wizards":        `${NBA}/wsh.png`,
  "washington bullets":        `${NBA}/wsh.png`,  // historical
  // ABA teams that overlap with NBA history
  "new york nets":             `${NBA}/bkn.png`,
  "virginia squires":          `${NBA}/bkn.png`,  // no real logo, rough fallback
  "pittsburgh condors":        `${NBA}/pit.png`,
  "minnesota muskies":         `${NBA}/min.png`,
  // ── NFL ──────────────────────────────────────────────────────────────────────
  "arizona cardinals":         `${NFL}/ari.png`,
  "chicago cardinals":         `${NFL}/ari.png`,  // historical
  "atlanta falcons":           `${NFL}/atl.png`,
  "baltimore ravens":          `${NFL}/bal.png`,
  "buffalo bills":             `${NFL}/buf.png`,
  "carolina panthers":         `${NFL}/car.png`,
  "chicago bears":             `${NFL}/chi.png`,
  "cincinnati bengals":        `${NFL}/cin.png`,
  "cleveland browns":          `${NFL}/cle.png`,
  "dallas cowboys":            `${NFL}/dal.png`,
  "denver broncos":            `${NFL}/den.png`,
  "detroit lions":             `${NFL}/det.png`,
  "green bay packers":         `${NFL}/gb.png`,
  "houston texans":            `${NFL}/hou.png`,
  "houston oilers":            `${NFL}/ten.png`,  // historical → now Titans
  "indianapolis colts":        `${NFL}/ind.png`,
  "baltimore colts":           `${NFL}/ind.png`,  // historical
  "jacksonville jaguars":      `${NFL}/jax.png`,
  "kansas city chiefs":        `${NFL}/kc.png`,
  "las vegas raiders":         `${NFL}/lv.png`,
  "oakland raiders":           `${NFL}/lv.png`,   // historical
  "los angeles raiders":       `${NFL}/lv.png`,   // historical
  "los angeles chargers":      `${NFL}/lac.png`,
  "san diego chargers":        `${NFL}/lac.png`,  // historical
  "los angeles rams":          `${NFL}/lar.png`,
  "st. louis rams":            `${NFL}/lar.png`,  // historical
  "st. louis football cardinals": `${NFL}/ari.png`, // historical NFL Cardinals (distinct from MLB)
  "miami dolphins":            `${NFL}/mia.png`,
  "minnesota vikings":         `${NFL}/min.png`,
  "new england patriots":      `${NFL}/ne.png`,
  "boston patriots":           `${NFL}/ne.png`,   // historical
  "new orleans saints":        `${NFL}/no.png`,
  "new york giants":           `${NFL}/nyg.png`,
  "new york jets":             `${NFL}/nyj.png`,
  "philadelphia eagles":       `${NFL}/phi.png`,
  "pittsburgh steelers":       `${NFL}/pit.png`,
  "san francisco 49ers":       `${NFL}/sf.png`,
  "seattle seahawks":          `${NFL}/sea.png`,
  "tampa bay buccaneers":      `${NFL}/tb.png`,
  "tennessee titans":          `${NFL}/ten.png`,
  "washington commanders":     `${NFL}/wsh.png`,
  "washington football team":  `${NFL}/wsh.png`,
  "washington redskins":       `${NFL}/wsh.png`,  // historical
  // ── MLB ──────────────────────────────────────────────────────────────────────
  "arizona diamondbacks":      `${MLB}/ari.png`,
  "atlanta braves":            `${MLB}/atl.png`,
  "baltimore orioles":         `${MLB}/bal.png`,
  "boston red sox":            `${MLB}/bos.png`,
  "chicago cubs":              `${MLB}/chc.png`,
  "chicago white sox":         `${MLB}/cws.png`,
  "cincinnati reds":           `${MLB}/cin.png`,
  "cleveland guardians":       `${MLB}/cle.png`,
  "cleveland indians":         `${MLB}/cle.png`,  // historical
  "colorado rockies":          `${MLB}/col.png`,
  "detroit tigers":            `${MLB}/det.png`,
  "houston astros":            `${MLB}/hou.png`,
  "kansas city royals":        `${MLB}/kc.png`,
  "los angeles angels":        `${MLB}/laa.png`,
  "california angels":         `${MLB}/laa.png`,  // historical
  "anaheim angels":            `${MLB}/laa.png`,  // historical
  "los angeles dodgers":       `${MLB}/lad.png`,
  "brooklyn dodgers":          `${MLB}/lad.png`,  // historical
  "miami marlins":             `${MLB}/mia.png`,
  "florida marlins":           `${MLB}/mia.png`,  // historical
  "milwaukee brewers":         `${MLB}/mil.png`,
  "minnesota twins":           `${MLB}/min.png`,
  "washington senators":       `${MLB}/min.png`,  // historical → Twins
  "new york mets":             `${MLB}/nym.png`,
  "new york yankees":          `${MLB}/nyy.png`,
  "athletics":                 `${MLB}/oak.png`,
  "oakland athletics":         `${MLB}/oak.png`,
  "las vegas athletics":       `${MLB}/oak.png`,
  "philadelphia phillies":     `${MLB}/phi.png`,
  "pittsburgh pirates":        `${MLB}/pit.png`,
  "st. louis cardinals":       `${MLB}/stl.png`,
  "san diego padres":          `${MLB}/sd.png`,
  "san francisco giants":      `${MLB}/sf.png`,
  "san francisco / new york giants": `${MLB}/sf.png`, // avoid collision with NFL
  "seattle mariners":          `${MLB}/sea.png`,
  "tampa bay rays":            `${MLB}/tb.png`,
  "tampa bay devil rays":      `${MLB}/tb.png`,   // historical
  "texas rangers":             `${MLB}/tex.png`,
  "toronto blue jays":         `${MLB}/tor.png`,
  "washington nationals":      `${MLB}/wsh.png`,
  "montreal expos":            `${MLB}/wsh.png`,  // historical
  // ── NHL ──────────────────────────────────────────────────────────────────────
  "anaheim ducks":             `${NHL}/ana.png`,
  "mighty ducks of anaheim":   `${NHL}/ana.png`,  // historical
  "arizona coyotes":           `${NHL}/ari.png`,
  "phoenix coyotes":           `${NHL}/ari.png`,  // historical
  "utah hockey club":          `${NHL}/ari.png`,  // new franchise location
  "boston bruins":             `${NHL}/bos.png`,
  "buffalo sabres":            `${NHL}/buf.png`,
  "calgary flames":            `${NHL}/cgy.png`,
  "carolina hurricanes":       `${NHL}/car.png`,
  "hartford whalers":          `${NHL}/car.png`,  // historical
  "chicago blackhawks":        `${NHL}/chi.png`,
  "colorado avalanche":        `${NHL}/col.png`,
  "quebec nordiques":          `${NHL}/col.png`,  // historical
  "columbus blue jackets":     `${NHL}/cbj.png`,
  "dallas stars":              `${NHL}/dal.png`,
  "minnesota north stars":     `${NHL}/dal.png`,  // historical
  "detroit red wings":         `${NHL}/det.png`,
  "edmonton oilers":           `${NHL}/edm.png`,
  "florida panthers":          `${NHL}/fla.png`,
  "los angeles kings":         `${NHL}/la.png`,
  "minnesota wild":            `${NHL}/min.png`,
  "montreal canadiens":        `${NHL}/mtl.png`,
  "nashville predators":       `${NHL}/nsh.png`,
  "new jersey devils":         `${NHL}/nj.png`,
  "new york islanders":        `${NHL}/nyi.png`,
  "new york rangers":          `${NHL}/nyr.png`,
  "ottawa senators":           `${NHL}/ott.png`,
  "philadelphia flyers":       `${NHL}/phi.png`,
  "pittsburgh penguins":       `${NHL}/pit.png`,
  "san jose sharks":           `${NHL}/sj.png`,
  "seattle kraken":            `${NHL}/sea.png`,
  "st. louis blues":           `${NHL}/stl.png`,
  "tampa bay lightning":       `${NHL}/tb.png`,
  "toronto maple leafs":       `${NHL}/tor.png`,
  "vancouver canucks":         `${NHL}/van.png`,
  "vegas golden knights":      `${NHL}/vgk.png`,
  "washington capitals":       `${NHL}/wsh.png`,
  "winnipeg jets":             `${NHL}/wpg.png`,
  "atlanta thrashers":         `${NHL}/wpg.png`,  // historical → Jets
};

// Irregularly-cased words that can't be derived by simple title-case
const WORD_OVERRIDES: Record<string, string> = {
  supersonics: "SuperSonics",
};
// Lowercase-only words (prepositions/articles in team names)
const LOWER_IN_NAME = new Set(["of", "the", "a", "an", "and", "or", "at", "in", "on"]);

function toTitleCase(s: string): string {
  return s
    .split(" ")
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (WORD_OVERRIDES[lower]) return WORD_OVERRIDES[lower];
      if (i > 0 && LOWER_IN_NAME.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Get the ESPN CDN logo URL for a team name (case-insensitive). Returns null if unknown. */
export function getTeamLogo(name: string): string | null {
  const key = name.toLowerCase().trim();
  if (TEAM_LOGO_MAP[key]) return TEAM_LOGO_MAP[key];
  for (const [k, url] of Object.entries(TEAM_LOGO_MAP)) {
    if (key.includes(k) || k.includes(key)) return url;
  }
  return null;
}

/**
 * Returns the canonical full team name for any known professional team abbreviation
 * or partial name. E.g. "Hornets" → "Charlotte Hornets", "OKC" → null (not a map key).
 * Returns null if the name isn't in the whitelist.
 */
export function getCanonicalTeamName(name: string): string | null {
  const key = name.toLowerCase().trim();
  if (TEAM_LOGO_MAP[key]) return toTitleCase(key);
  for (const [k] of Object.entries(TEAM_LOGO_MAP)) {
    if (key.includes(k) || k.includes(key)) return toTitleCase(k);
  }
  return null;
}

/** Returns true if this is a known major-league professional team. */
export function isKnownProfessionalTeam(name: string): boolean {
  return getTeamLogo(name) !== null;
}
