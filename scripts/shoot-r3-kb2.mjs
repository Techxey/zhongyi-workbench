import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error") problems.push(m.text());
});
page.on("pageerror", (e) => problems.push(String(e)));

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

await page.goto(`${BASE}/kb`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await page.getByText("归脾汤", { exact: false }).first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}\\81-r3-kb-detail.png` });
console.log("shot 81");

await page.keyboard.press("Escape");
await page.goto(`${BASE}/kb`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: /^中药/ }).first().click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}\\82-r3-kb-herbs.png` });
console.log("shot 82");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 8).join("\n") : "none");
await browser.close();
