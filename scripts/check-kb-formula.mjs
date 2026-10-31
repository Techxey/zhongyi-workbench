import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const SHOTS = "D:\\zhongyiqianduan\\screenshots";
// 已签名的第 1 次就诊（方名手填「归脾汤」，没有 kbItemId 快照）
const VISIT_ID = process.env.VISIT_ID || "2c2883de-1b03-46c3-8ef3-94385f874ebe";

const problems = [];
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);
await page.goto(`${BASE}/visits/${VISIT_ID}`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await page.screenshot({ path: `${SHOTS}\\29-r2-kb-formula.png` });
const commentary = await page.locator("section:has-text('方解摘录')").last().innerText();
const formulaCard = await page.locator("section:has-text('处方')").first().innerText();
console.log("方解摘录:", commentary.replace(/\s+/g, " ").slice(0, 160));
console.log("方名卡:", formulaCard.replace(/\s+/g, " ").slice(0, 160));
console.log("=== problems ===");
console.log(problems.length === 0 ? "none" : problems.join("\n"));
await browser.close();
