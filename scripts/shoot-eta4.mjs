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

await page.goto(`${BASE}/visits`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(900);
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 25000 }),
  page.locator('a:has-text("继续接诊")').first().click(),
]);
await page.waitForTimeout(1800);
console.log("visit:", page.url());

await page.fill("#chief", "咽干咽痛 2 天，伴轻微咳嗽");
await page.locator('button:has-text("外感风热")').first().click().catch(() => {});
await page.locator('#syndrome').fill("风热犯肺").catch(() => {});
const herb = page.locator('input[aria-label$="味药名"]').first();
await herb.click();
await herb.type("连翘", { delay: 50 });
await page.waitForTimeout(400);
await shot("118-eta-autocomplete-clean");
await herb.press("Enter");
await page.waitForTimeout(300);
await page.fill('input[aria-label="第 1 味剂量"]', "12");
await page.waitForTimeout(3200);
console.log("topbar:", (await page.locator("header").first().innerText()).replace(/\s+/g, " "));

const saveBtn = page.locator('button:has-text("保存并签名")');
console.log("save enabled:", await saveBtn.isEnabled());
await saveBtn.click();
await page.waitForTimeout(3500);
console.log("after save:", page.url(), "toast:", await page.locator("text=已保存第").count());
await shot("119-eta-saved");

await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
console.log("restored toast after save:", await page.locator("text=已恢复上次自动保存的草稿").count());
await shot("120-eta-after-reload");

console.log("problems:", problems.length ? problems.slice(0, 4).join(" | ") : "none");
await browser.close();
