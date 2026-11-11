import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function newContext(theme) {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "zh-CN",
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  await ctx.addCookies([
    { name: "zyb_theme", value: theme, url: BASE },
  ]);
  return ctx;
}

async function shot(page, name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}\\${name}.png` });
  console.log(`shot ${name} (${page.url()})`);
}

const problems = [];

// —— 夜间：登录页 ——
const darkCtx = await newContext("dark");
const page = await darkCtx.newPage();
page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error" && !m.text().includes("404")) problems.push(`console: ${m.text()}`);
});

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
const htmlClass = await page.getAttribute("html", "class");
console.log("html class (dark cookie):", JSON.stringify(htmlClass), "| bg:", await page.evaluate(() => getComputedStyle(document.body).backgroundColor));
await shot(page, "10-dark-login");

// 用浮动开关切回日间，验证切换生效且不改地址
await page.click('button[aria-label="切换日间 / 夜间模式"]');
await page.waitForTimeout(500);
const afterToggle = await page.evaluate(() => ({
  cls: document.documentElement.className,
  bg: getComputedStyle(document.body).backgroundColor,
  cookie: document.cookie,
}));
console.log("after toggle ->", JSON.stringify(afterToggle));

// 再切回夜间，继续拍
await page.click('button[aria-label="切换日间 / 夜间模式"]');
await page.waitForTimeout(400);

// —— 夜间：登录后各页 ——
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);
await shot(page, "11-dark-patients");

await page.goto(`${BASE}/patients/new`, { waitUntil: "networkidle" });
await shot(page, "12-dark-patient-new");

// 打开已有患者详情（列表第一条）
await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
const firstRow = page.locator("table tbody tr a").first();
if (await firstRow.count()) {
  await Promise.all([
    page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
    firstRow.click(),
  ]);
  await page.waitForLoadState("networkidle");
  await shot(page, "13-dark-patient-detail");
} else {
  problems.push("no patient row found");
}

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await shot(page, "14-dark-settings");

// 设置页里点“日间”，验证三档控件即时切换
await page.click('button[aria-pressed]:has-text("日间")');
await page.waitForTimeout(500);
const afterSeg = await page.evaluate(() => ({
  cls: document.documentElement.className,
  bg: getComputedStyle(document.body).backgroundColor,
}));
console.log("segmented -> light:", JSON.stringify(afterSeg));
await shot(page, "15-light-settings-after-switch");

// —— 日间（对照，确认浅色没被改坏）——
const lightCtx = await newContext("light");
const lp = await lightCtx.newPage();
await lp.goto(`${BASE}/login`, { waitUntil: "networkidle" });
console.log("light body bg:", await lp.evaluate(() => getComputedStyle(document.body).backgroundColor));
await shot(lp, "16-light-login-check");

console.log("\n=== problems ===");
console.log(problems.length ? problems.join("\n") : "none");
await browser.close();
