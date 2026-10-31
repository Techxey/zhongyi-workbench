import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator("table tbody tr").last().locator("a").first().click(),
]);
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.getByRole("button", { name: /开始接诊|继续接诊/ }).first().click(),
]);
await page.waitForTimeout(800);

// 第一次带入：归脾汤
await page.keyboard.press("Control+k");
await page.waitForTimeout(400);
await page.keyboard.type("归脾");
await page.waitForTimeout(1300);
await page.keyboard.press("Enter");
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}\\63-r3-inserted.png` });
console.log("shot 63");

// 第二次带入：逍遥散 → 已有药味，弹替换/追加
await page.keyboard.press("Control+k");
await page.waitForTimeout(400);
await page.keyboard.type("逍遥");
await page.waitForTimeout(1300);
await page.keyboard.press("Enter");
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}\\64-r3-replace-ask.png` });
console.log("shot 64");
await page.getByRole("button", { name: /替换为这个方/ }).click();
await page.waitForTimeout(700);
await page.screenshot({ path: `${OUT}\\65-r3-replaced.png` });
console.log("shot 65");
await browser.close();
