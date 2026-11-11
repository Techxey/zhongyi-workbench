import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";
const TMP = "D:\\zhongyiqianduan\\tmp-uploads";

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

// —— 演示批次（2 行，均为警告行）：全部导入 → 撤销 ——
await page.goto(`${BASE}/kb/import`, { waitUntil: "networkidle" });
const before = await page.locator("table").first().innerText();
await page.locator('input[type="file"]').setInputFiles(`${TMP}\\rollback-demo.csv`);
await page.waitForSelector("text=预览前", { timeout: 30000 });
await page.getByRole("button", { name: /下一步：字段映射/ }).click();
await page.waitForTimeout(600);
await page.getByRole("button", { name: /下一步：校验/ }).click();
await page.waitForSelector("text=校验结果", { timeout: 60000 });
await page.waitForTimeout(1200);
await shot("76-r3-rollback-03-validate");
const allBtn = page.getByRole("button", { name: /全部导入（警告行也入库）/ });
for (let i = 0; i < 30; i++) {
  if (await allBtn.isEnabled().catch(() => false)) break;
  await page.waitForTimeout(400);
}
await allBtn.click();
await page.waitForSelector("text=导入完成", { timeout: 120000 });
await page.waitForTimeout(1200);
await shot("76-r3-rollback-04-committed");
const commitText = await page.locator("body").innerText();
console.log("commit:", commitText.split("\n").filter((l) => /已入库|写入|新增|更新/.test(l)).slice(0, 6).join(" | "));

// 撤销本批次
await page.getByRole("button", { name: /撤销本批次/ }).click();
await page.waitForTimeout(2500);
await shot("77-r3-rollback-done");
const afterRollback = await page.locator("body").innerText();
console.log("rollback:", afterRollback.split("\n").filter((l) => /已撤销|删除|回退/.test(l)).slice(0, 6).join(" | "));

// —— 知识库总览 ——
await page.goto(`${BASE}/kb`, { waitUntil: "networkidle" });
await page.waitForTimeout(900);
await shot("78-r3-kb-full");
console.log("kb page:", (await page.locator("body").innerText()).split("\n").slice(0, 8).join(" | "));

// —— 接诊台里检索：带症状上下文 ——
await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator("table tbody tr").first().locator("a").first().click(),
]);
const startBtn = page.getByRole("button", { name: /开始接诊|继续接诊/ });
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  startBtn.click(),
]);
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
summarize(await page.locator("body").innerText());
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(500);
await shot("80-r3-overlay-detail");

function summarize(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const interesting = lines.filter((l) => /方剂|中药|医案|古籍|吻合|知识库 v3|识别为/.test(l));
  console.log("overlay:", interesting.slice(0, 12).join(" | "));
}

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 10).join("\n") : "none");
await browser.close();
