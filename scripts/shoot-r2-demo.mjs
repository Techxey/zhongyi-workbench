import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const SHOTS = "D:\\zhongyiqianduan\\screenshots";
const VISIT_ID = process.env.VISIT_ID || "";

const problems = [];
const browser = await chromium.launch({ executablePath: EDGE, headless: true });

async function makePage(theme = "light") {
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: theme === "dark" ? "dark" : "light",
  });
  await ctx.addCookies([{ name: "zyb_theme", value: theme, url: BASE }]);
  const page = await ctx.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") problems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  return page;
}

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', "doctor");
  await page.fill('input[name="password"]', "doctor1234");
  await Promise.all([
    page.waitForURL("**/patients", { timeout: 20000 }),
    page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
  ]);
  await page.waitForLoadState("networkidle");
}

async function shot(page, name) {
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${SHOTS}\\${name}.png` });
  console.log(`shot ${name} (${page.url()})`);
}

const page = await makePage("light");
await login(page);
await shot(page, "30-r2-patients");

// 患者详情 · 就诊时间轴
const chenRow = page.locator("table tbody tr", { hasText: "陈素梅" }).first();
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  chenRow.locator("a").first().click(),
]);
await page.waitForLoadState("networkidle");
await shot(page, "31-r2-patient-history");

// 已签名接诊台
await page.goto(`${BASE}/visits/${VISIT_ID}`, { waitUntil: "networkidle" });
await shot(page, "32-r2-visit-signed");

// A5 打印
const printPage = await (await page.context().browser().newContext({
  viewport: { width: 559, height: 794 },
  deviceScaleFactor: 2,
})).newPage();
await printPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await printPage.fill('input[name="username"]', "doctor");
await printPage.fill('input[name="password"]', "doctor1234");
await Promise.all([
  printPage.waitForURL("**/patients", { timeout: 20000 }),
  printPage.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);
await printPage.goto(`${BASE}/print/prescription/${VISIT_ID}`, { waitUntil: "networkidle" });
await printPage.waitForTimeout(400);
await printPage.screenshot({ path: `${SHOTS}\\33-r2-print.png`, fullPage: true });
console.log("shot 33-r2-print", await printPage.title());
await printPage.close();

// 复诊：开始接诊 + 带入上次记录（会产生一条草稿就诊，脚本跑完由 db-cleanup 清掉）
await page.goto(`${BASE}/patients/${process.env.PATIENT_ID}`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('form:has(button:has-text("开始接诊")), form:has(button:has-text("继续接诊"))').first().locator('button[type="submit"]').click(),
]);
await page.waitForLoadState("networkidle");
await page.locator('button:has-text("带入上次记录")').click();
await page.waitForTimeout(500);
await shot(page, "34-r2-revisit");
const chief = await page.inputValue("#chief");
const firstHerb = await page.locator('input[aria-label$="味药名"]').first().inputValue();
console.log("带入后: 主诉保留空=", chief === "", "首味=", firstHerb);

// 夜间接诊台
const darkPage = await makePage("dark");
await login(darkPage);
await darkPage.goto(`${BASE}/visits/${VISIT_ID}`, { waitUntil: "networkidle" });
await shot(darkPage, "35-r2-visit-dark");

console.log("=== problems ===");
console.log(problems.length === 0 ? "none" : problems.join("\n"));
await browser.close();
