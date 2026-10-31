import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";
const SEED = "D:\\zhongyiqianduan\\data\\seed";
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

async function importFile(file, prefix) {
  await page.goto(`${BASE}/kb/import`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForSelector("text=预览前", { timeout: 30000 });
  await shot(`${prefix}-01-upload`);
  await page.getByRole("button", { name: /下一步：字段映射/ }).click();
  await page.waitForTimeout(600);
  await shot(`${prefix}-02-mapping`);
  await page.getByRole("button", { name: /下一步：校验/ }).click();
  await page.waitForSelector("text=校验结果", { timeout: 60000 });
  await page.waitForTimeout(1200);
  await shot(`${prefix}-03-validate`);
  const summary = await page.locator("body").innerText();
  console.log(`${prefix} summary snippet:`, summary.split("\n").filter((l) => /共|通过|警告|错误/.test(l)).slice(0, 6).join(" | "));
  const passBtn = page.getByRole("button", { name: /仅导入通过行/ });
  const allBtn = page.getByRole("button", { name: /全部导入（警告行也入库）/ });
  let commitBtn = passBtn;
  for (let i = 0; i < 40; i++) {
    if (await passBtn.isEnabled().catch(() => false)) break;
    if (await allBtn.isEnabled().catch(() => false)) {
      commitBtn = allBtn;
      break;
    }
    await page.waitForTimeout(500);
  }
  if (!(await commitBtn.isEnabled().catch(() => false))) throw new Error("commit still disabled");
  await commitBtn.click();
  await page.waitForSelector("text=导入完成", { timeout: 120000 });
  await page.waitForTimeout(800);
  await shot(`${prefix}-04-committed`);
  return summary;
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

console.log("== import formulas ==");
await importFile(`${SEED}\\formulas.csv`, "74-r3-import-formulas");
console.log("== import herbs ==");
await importFile(`${SEED}\\herbs.csv`, "75-r3-import-herbs");
console.log("== rollback demo ==");
await importFile(`${TMP}\\rollback-demo.csv`, "76-r3-rollback");

// 撤销刚导入的批次（页面上方成功态的「撤销本批次」）
await page.getByRole("button", { name: /撤销本批次/ }).click();
await page.waitForTimeout(1500);
await shot("77-r3-rollback-done");

// 知识库总览
await page.goto(`${BASE}/kb`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
await shot("78-r3-kb-full");

// 检索：带症状上下文
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
await page.waitForTimeout(800);
// 选症状：入睡困难 / 多梦 / 乏力
for (const term of ["入睡困难", "多梦", "乏力"]) {
  const chip = page.locator(`button[data-term="${term}"]`).first();
  if (await chip.count()) await chip.click();
  else {
    const any = page.getByRole("button", { name: term, exact: true }).first();
    if (await any.count()) await any.click();
  }
}
await page.keyboard.press("Control+k");
await page.waitForTimeout(500);
await page.keyboard.type("失眠");
await page.waitForTimeout(1400);
await shot("79-r3-overlay-herbs-hits");
await page.keyboard.press("ArrowRight");
await page.waitForTimeout(400);
await shot("80-r3-overlay-detail");
await page.keyboard.press("Escape");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 10).join("\n") : "none");
await browser.close();
