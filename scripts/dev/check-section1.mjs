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

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
const account = page.locator('section:has(h2:has-text("账号"))').first();
await account.scrollIntoViewIfNeeded();
await page.waitForTimeout(300);
console.log("password inputs:", await page.locator('input[type="password"]').count());
await account.screenshot({ path: `${OUT}\\98-s1-settings-account.png` });

const backupSection = page.locator('section:has(h2:has-text("备份与导出"))').first();
await backupSection.scrollIntoViewIfNeeded();
await page.locator('button:has-text("立即备份")').first().click();
await page.waitForTimeout(2500);
const msg = await page.locator("p.text-brand").first().textContent().catch(() => null);
console.log("backup message:", msg);
console.log("rows after backup:", await backupSection.locator("tbody tr").count());
await backupSection.screenshot({ path: `${OUT}\\99-s1-backup-toast.png` });

const exportInfo = await page.evaluate(async () => {
  const response = await fetch("/api/export");
  const text = await response.text();
  try {
    const json = JSON.parse(text);
    return { status: response.status, counts: json.counts, patients: json.data?.patient?.length };
  } catch {
    return { status: response.status, head: text.slice(0, 80) };
  }
});
console.log("export:", JSON.stringify(exportInfo));

const backupDownload = await page.evaluate(async () => {
  const link = document.querySelector('a[href^="/api/backup/"]');
  const response = await fetch(link?.getAttribute("href") ?? "/api/backup/none.db");
  return { status: response.status, type: response.headers.get("content-type"), size: (await response.arrayBuffer()).byteLength };
});
console.log("download:", JSON.stringify(backupDownload));

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 6).join("\n") : "none");
await browser.close();
