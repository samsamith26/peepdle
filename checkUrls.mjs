// Test a sample of stored imageUrls to see what HTTP response they return
const urls = [
  // Actors
  "https://en.wikipedia.org/wiki/Special:FilePath/Tom%20Hanks%202014.jpg?width=200",
  "https://en.wikipedia.org/wiki/Special:FilePath/Meryl%20Streep%202012.jpg?width=200",
  "https://en.wikipedia.org/wiki/Special:FilePath/Zendaya%20at%20the%202019%20CFDA%20Fashion%20Awards%20(cropped).jpg?width=200",
  // Athletes
  "https://en.wikipedia.org/wiki/Special:FilePath/LeBron%20James%20crop.jpg?width=200",
  "https://en.wikipedia.org/wiki/Special:FilePath/Stephen%20Curry%20Shooting.jpg?width=200",
];

for (const url of urls) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    const ct = res.headers.get("content-type") ?? "unknown";
    const finalUrl = res.url;
    console.log(`${res.status} ${ct.split(";")[0].padEnd(12)} ${finalUrl.slice(0, 80)}`);
    if (!res.ok || !ct.startsWith("image/")) {
      console.log(`  ⚠ Original: ${url}`);
    }
  } catch (e) {
    console.log(`  ERROR: ${e.message}`);
    console.log(`  URL: ${url}`);
  }
}
