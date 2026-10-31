import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";

mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: "zh-CN",
});
const page = await context.newPage();

const problems = [];
page.on("console", (msg) => {
  if (msg.type() === "error") problems.push(`console: ${msg.text()}`);
});
page.on("pageerror", (err) => problems.push(`pageerror: ${err.message}`));
page.on("requestfailed", (req) => {
  const url = req.url();
  if (!url.includes("favicon")) problems.push(`requestfailed: ${url} ${req.failure()?.errorText}`);
});

async function shot(name, path) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}\\${name}.png` });
  console.log(`shot ${name} <- ${path} (${page.url()})`);
}

// 1. 登录页
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shot("01-login", "/login");

// 2. 登录
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);
await shot("02-patients-empty", "/patients");

// 3. 新建患者
await page.goto(`${BASE}/patients/new`, { waitUntil: "networkidle" });
await page.fill('input[name="name"]', "张淑芬");
await page.selectOption('select[name="gender"]', "female");
await page.fill('input[name="birthYear"]', "1984");
await page.fill('input[name="phone"]', "13812346621");
await page.selectOption('select[name="constitution"]', "气虚质");
await page.fill('textarea[name="allergy"]', "青霉素过敏");
await page.fill(
  "textarea[name='pastHistory']",
  "高血压 5 年，服氨氯地平 5mg qd；2021 年阑尾切除术后。",
);
await shot("03-patient-new", "/patients/new");

await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('form:has(input[name="name"]) button[type="submit"]').click(),
]);
await shot("04-patient-detail", "patient detail");

// 4. 患者列表（有数据）
await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
await shot("05-patients-list", "/patients");

// 5. 列表搜索
await page.fill('input[aria-label="搜索患者"]', "zsf");
await page.waitForTimeout(250);
await shot("06-patients-search", "/patients?q=zsf");

// 6. 设置
await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
await shot("07-settings", "/settings");

// 7. 手机号查看 + 编辑态
await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
await page.click("table tbody tr a");
await page.waitForLoadState("networkidle");
await page.click("text=查看完整");
await page.waitForTimeout(400);
await shot("08-detail-phone", "revealed phone");
await page.click("text=编辑");
await page.waitForTimeout(200);
await shot("09-detail-edit", "edit mode");

console.log("\n=== problems ===");
console.log(problems.length ? problems.join("\n") : "none");

await browser.close();
