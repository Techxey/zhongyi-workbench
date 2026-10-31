import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(msg.text());
});
page.on("pageerror", (err) => problems.push(String(err)));
page.on("dialog", (dialog) => dialog.accept());

async function shot(name, wait = 400) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: `${OUT}\\${name}.png` });
  console.log(`shot ${name} (${page.url()})`);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

// 接诊首页：待复诊卡
await page.goto(`${BASE}/visits`, { waitUntil: "networkidle" });
await shot("90-s1-visits-followup");

// 设置页：备份卡 + 改密
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await page.evaluate(() => window.scrollTo(0, 520));
await shot("91-s1-settings-backup");
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await shot("92-s1-settings-password");

// 点一次立即备份
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const backupBtn = page.locator('button:has-text("立即备份")').first();
if (await backupBtn.count()) {
  await backupBtn.click();
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.scrollTo(0, 520));
  await shot("93-s1-backup-done", 300);
}

// 审计页
await page.goto(`${BASE}/settings/audit`, { waitUntil: "networkidle" });
await shot("94-s1-audit");
await page.locator("details").first().click();
await shot("95-s1-audit-detail", 300);

// 接诊台：常用方面板 + 套用
await page.goto(`${BASE}/visits`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('a:has-text("继续接诊")').first().click(),
]);
await page.evaluate(() => window.scrollTo(0, 380));
const tpl = page.locator('summary:has-text("我的常用方")').first();
if (await tpl.count()) {
  await tpl.click();
  await page.waitForTimeout(300);
}
await shot("96-s1-template-open", 300);
const applyBtn = page.locator('button:has-text("套用")').first();
if (await applyBtn.count()) {
  await applyBtn.click();
  await page.waitForTimeout(900);
}
await shot("97-s1-template-applied", 300);

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 8).join("\n") : "none");
await browser.close();
