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

async function shot(name, wait = 380) {
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

// 张淑芬（第一行，无就诊）
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator("table tbody tr").first().locator("a").first().click(),
]);
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.getByRole("button", { name: /开始接诊|继续接诊/ }).first().click(),
]);
console.log("visit:", page.url());

// 打开浮层（空查询）
await page.keyboard.press("Control+k");
await page.waitForTimeout(700);
await shot("60-r3-overlay-empty");

// 搜「归脾」
const input = page.locator('input[aria-label="知识库检索输入"]');
await input.fill("归脾");
await page.waitForTimeout(900);
await shot("61-r3-overlay-formula");

// 搜「失眠」看意图标签
await input.fill("失眠");
await page.waitForTimeout(900);
await shot("62-r3-overlay-intent");

// 回到「归脾」并回车带入处方（空处方，直接写入）
await input.fill("归脾");
await page.waitForTimeout(900);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);
await page.screenshot({ path: `${OUT}\\63-r3-inserted.png` });
console.log("shot 63-r3-inserted");

// 再搜一首方，验证「替换 / 追加」
await page.keyboard.press("Control+k");
await page.waitForTimeout(600);
await page.locator('input[aria-label="知识库检索输入"]').fill("逍遥");
await page.waitForTimeout(1000);
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
await shot("64-r3-replace-ask");
await page.getByRole("button", { name: "替换为这个方" }).click();
await page.waitForTimeout(800);
await shot("65-r3-replaced");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 8).join("\n") : "none");
await browser.close();
