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

const shot = async (name) => {
  await page.screenshot({ path: `${OUT}\\${name}.png` });
  console.log("shot", name);
};

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

// 张淑芬的草稿
await page.goto(`${BASE}/visits`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('a:has-text("继续接诊")').first().click(),
]);
console.log("visit", page.url());

// 药名补全：输入 huang
const herb = page.locator('input[aria-label$="味药名"]').first();
await herb.click();
await herb.type("huang", { delay: 60 });
await page.waitForTimeout(300);
await shot("110-eta-herb-suggest");
const options = await page.locator('div.absolute >> button').count();
console.log("suggest options:", options);

// 键盘选第一个
await herb.press("Enter");
await page.waitForTimeout(300);
const firstRow = await page.locator('li:has(input[aria-label$="味药名"])').first().evaluate((li) => {
  const inputs = [...li.querySelectorAll("input")].map((i) => i.value);
  return inputs;
});
console.log("first row after pick:", firstRow);

// 中文首字补全
await herb.fill("");
await herb.type("当", { delay: 60 });
await page.waitForTimeout(300);
const zhOptions = await page.locator('div.absolute >> button').allTextContents();
console.log("zh suggest:", zhOptions.slice(0, 4));
await shot("111-eta-herb-suggest-zh");
await page.keyboard.press("Escape");

// 自动保存：填主诉后等 3 秒
await page.fill("#chief", "入睡困难 3 月余，加重 2 周");
await page.waitForTimeout(3400);
const subtitle = await page.locator("header").first().innerText();
console.log("subtitle:", subtitle.replace(/\s+/g, " "));
await shot("112-eta-draft-saved");

// 刷新恢复草稿
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(900);
const chief = await page.inputValue("#chief");
const toast = await page.locator("text=已恢复上次自动保存的草稿").count();
console.log("restored chief:", chief, "| toast:", toast > 0);
await shot("113-eta-draft-restored");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 6).join("\n") : "none");
await browser.close();
