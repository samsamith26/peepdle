import { chromium } from "playwright";

const SCREENSHOT_PATH = "C:/Users/19254/AppData/Local/Temp/claude/c--Users-19254-Desktop-celebridle/9ee66c5e-ddbb-482f-baf3-40a86425d9a0/scratchpad/actordle.png";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.on("console", msg => { if (msg.type() === "error") console.log("CONSOLE ERR:", msg.text()); });
page.on("requestfailed", req => console.log("REQUEST FAILED:", req.url(), req.failure()?.errorText));
await page.setViewportSize({ width: 900, height: 1000 });
await page.goto("http://localhost:3000/actordle", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);

const input = page.locator("input");
await input.fill("Tom Hanks");
await page.waitForTimeout(500);
const suggestion = page.locator("li").filter({ hasText: "Tom Hanks" }).first();
await suggestion.click();
await page.waitForTimeout(300);
await page.locator("button", { hasText: "Guess" }).click();
await page.waitForTimeout(4000);

await page.screenshot({ path: SCREENSHOT_PATH, fullPage: false });
console.log("Screenshot saved.");
await browser.close();
