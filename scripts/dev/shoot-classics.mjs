import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
page.on("pageerror", (e) => problems.push(String(e)));

const shot = async (n) => {
  await page.screenshot({ path: `${OUT}\\${n}.png` });
  console.log("shot", n);
};

await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 30000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

// 浮层：搜「失眠」，切到古籍页签
await page.goto(`${BASE}/visits`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.keyboard.press("Control+k");
await page.waitForTimeout(900);
await page.locator('input[placeholder*="方名"]').first().fill("失眠");
await page.waitForTimeout(1400);
const tabs = await page.locator("button[role='tab'], button").allTextContents();
console.log("tabs sample:", tabs.filter((t) => t.includes("古籍")).slice(0, 2));
await page.locator('button:has-text("古籍")').first().click();
await page.waitForTimeout(1200);
await shot("121-classic-overlay");
console.log("overlay url:", page.url());

// 展开第一部书的条文
const firstRow = page.locator("div[role='option'], li[role='option']").first();
if (await firstRow.count()) {
  await firstRow.click();
  await page.waitForTimeout(1200);
  await shot("122-classic-overlay-detail");
}

await page.keyboard.press("Escape");
await page.waitForTimeout(400);

// /kb 古籍页签
await page.goto(`${BASE}/kb`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.locator('button:has-text("古籍")').first().click();
await page.waitForTimeout(1200);
await shot("123-kb-classics");
const rows = await page.locator("tbody tr").count();
console.log("kb classic rows:", rows);

console.log("problems:", problems.length ? problems.slice(0, 4).join(" | ") : "none");
await browser.close();
