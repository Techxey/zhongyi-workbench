import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on("dialog", (d) => d.accept());

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

/** 直接问检索接口：命中数才是索引是否刷新的证据 */
async function apiHits(query) {
  return page.evaluate(async (q) => {
    const res = await fetch(`/api/kb/search?q=${encodeURIComponent(q)}`, { cache: "no-store" });
    const data = await res.json();
    if (!data.ok) return { error: data.message ?? "检索失败" };
    return {
      formulas: data.tabs.formula.hits.length,
      herbs: data.tabs.herb.hits.length,
      names: data.tabs.formula.hits.slice(0, 3).map((hit) => hit.name),
    };
  }, query);
}

async function importCsv(file) {
  await page.goto(`${BASE}/kb/import`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles(file);
  await page.waitForSelector("text=预览前", { timeout: 30000 });
  await page.getByRole("button", { name: /下一步：字段映射/ }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /下一步：校验/ }).click();
  await page.waitForSelector("text=校验结果", { timeout: 60000 });
  await page.waitForTimeout(1000);
  const passBtn = page.getByRole("button", { name: /仅导入通过行/ });
  for (let i = 0; i < 20; i++) {
    if (await passBtn.isEnabled().catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  await passBtn.click();
  await page.waitForSelector("text=导入完成", { timeout: 120000 });
}

const q = "索引校验汤";

// 先确认导入前查不到（索引里没有）
const before = await apiHits(q);
console.log("导入前：", JSON.stringify(before));

await importCsv("D:\\zhongyiqianduan\\tmp-index-check.csv");
const rightAfterImport = await apiHits(q);
console.log("导入后立刻：", JSON.stringify(rightAfterImport));

// 撤销这一批（台账第一行就是刚导入的批次）
await page.goto(`${BASE}/kb/import`, { waitUntil: "networkidle" });
await page.waitForTimeout(500);
await page.locator("table tbody tr").first().getByRole("button", { name: "撤销" }).click();
await page.waitForTimeout(3000);
const afterRollback = await apiHits(q);
console.log("撤销后立刻：", JSON.stringify(afterRollback));

const ok =
  (before.error || before.formulas === 0) &&
  rightAfterImport.formulas >= 1 &&
  (afterRollback.error || afterRollback.formulas === 0);
console.log(ok ? "PASS: 导入/撤销后索引立即刷新" : "FAIL: 索引未及时刷新");
await browser.close();
