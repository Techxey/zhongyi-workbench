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
  console.log(`shot ${name} :: ${page.url()}`);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

await page.goto(`${BASE}/visits`, { waitUntil: "networkidle" });
await shot("79a-r3-visits-home", 600);
const resume = page.getByRole("link", { name: /继续接诊/ }).first();
if (await resume.count()) {
  await Promise.all([page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }), resume.click()]);
} else {
  await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
  await Promise.all([
    page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
    page.locator("table tbody tr").first().locator("a").first().click(),
  ]);
  await Promise.all([
    page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
    page.getByRole("button", { name: /开始接诊|继续接诊/ }).first().click(),
  ]);
}
await page.waitForTimeout(900);

for (const term of ["入睡困难", "多梦", "乏力"]) {
  const chip = page.getByRole("button", { name: term, exact: true }).first();
  if (await chip.count()) await chip.click();
}
await page.keyboard.press("Control+k");
await page.waitForTimeout(500);
await page.keyboard.type("失眠");
await page.waitForTimeout(1600);
await shot("79-r3-overlay-hits");
const text = await page.locator("body").innerText();
console.log("overlay:", text.split("\n").filter((l) => /识别为|方剂|中药|吻合|知识库 v3/.test(l)).slice(0, 8).join(" | "));
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(500);
await shot("80-r3-overlay-detail");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 10).join("\n") : "none");
await browser.close();
