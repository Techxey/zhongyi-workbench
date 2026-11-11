import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const SHOTS = "D:\\zhongyiqianduan\\screenshots";

const problems = [];
const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark" });
await ctx.addCookies([{ name: "zyb_theme", value: "dark", url: BASE }]);
const page = await ctx.newPage();
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

async function shot(name) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${SHOTS}\\${name}.png` });
  console.log(`shot ${name} (${page.url()})`);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);
await page.waitForLoadState("networkidle");

// 最近一位患者（含历史处方的那位）
const row = page.locator("table tbody tr").first();
await Promise.all([page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }), row.locator("a").first().click()]);
await page.waitForLoadState("networkidle");
const startButton = page.locator('form:has(button:has-text("继续接诊")), form:has(button:has-text("开始接诊"))').first();
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  startButton.locator('button[type="submit"]').click(),
]);
await page.waitForLoadState("networkidle");
await shot("26-r2-visit-dark");

console.log("=== problems ===");
console.log(problems.length === 0 ? "none" : problems.join("\n"));
await browser.close();
