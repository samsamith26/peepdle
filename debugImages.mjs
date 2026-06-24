// Debug: trace the full resolution chain for a few known people

const UA = "celebridle-debug/1.0";
const DELAY_MS = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getWikidataP18Filename(name) {
  await sleep(DELAY_MS);
  const res = await fetch(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(name)}&language=en&format=json&limit=3`,
    { headers: { "User-Agent": UA } }
  );
  const data = await res.json();
  const qids = (data.search ?? []).map(r => r.id).slice(0, 3);
  console.log(`  QIDs for "${name}": ${qids.join(", ")}`);

  for (const qid of qids) {
    await sleep(DELAY_MS);
    const er = await fetch(
      `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qid}&props=claims&format=json`,
      { headers: { "User-Agent": UA } }
    );
    const ed = await er.json();
    const p18 = ed.entities?.[qid]?.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    if (p18) {
      console.log(`  P18 (${qid}): "${p18}"`);
      return p18.replace(/ /g, "_");
    }
    console.log(`  No P18 for ${qid}`);
  }
  return null;
}

async function commonsThumbUrl(filename) {
  await sleep(DELAY_MS);
  const fileTitle = `File:${filename.replace(/_/g, " ")}`;
  const apiUrl = `https://commons.wikimedia.org/w/api.php?action=query&titles=${encodeURIComponent(fileTitle)}&prop=imageinfo&iiprop=url&iiurlwidth=300&format=json`;
  console.log(`  Imageinfo URL: ${apiUrl}`);
  const res = await fetch(apiUrl, { headers: { "User-Agent": UA } });
  console.log(`  Imageinfo HTTP status: ${res.status}`);
  const data = await res.json();
  const pages = data.query?.pages ?? {};
  const page = Object.values(pages)[0];
  console.log(`  Page id: ${page?.pageid ?? "(missing)"}, imageinfo count: ${page?.imageinfo?.length ?? 0}`);
  const thumburl = page?.imageinfo?.[0]?.thumburl ?? null;
  console.log(`  thumburl: ${thumburl ?? "(null)"}`);
  return thumburl;
}

const TEST_PEOPLE = ["Tom Hanks", "Scarlett Johansson", "LeBron James", "Kobe Bryant"];

for (const name of TEST_PEOPLE) {
  console.log(`\n=== ${name} ===`);
  const filename = await getWikidataP18Filename(name);
  if (!filename) {
    console.log("  → No P18 found");
    continue;
  }
  console.log(`  filename (underscored): ${filename}`);
  const url = await commonsThumbUrl(filename);
  console.log(`  → Final URL: ${url ?? "NULL (failed)"}`);
}
