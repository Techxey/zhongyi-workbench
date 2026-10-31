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

async function shot(name) {
  await page.waitForTimeout(400);
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

await page.goto(`${BASE}/visits`, { waitUntil: "networkidle" });
await shot("70-r3-clinic");

await page.goto(`${BASE}/kb`, { waitUntil: "networkidle" });
await shot("71-r3-kb");

// 打开第一个条目的详情
await page.locator("table tbody tr").first().click();
await shot("72-r3-kb-detail");
await page.getByRole("button", { name: "关闭" }).click();

// 别名页签
await page.getByRole("button", { name: /别名/ }).click();
await shot("73-r3-kb-alias");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 8).join("\n") : "none");
await browser.close();
