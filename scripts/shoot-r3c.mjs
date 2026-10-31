import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const OUT = "D:\\zhongyiqianduan\\screenshots";
const TMP = "D:\\zhongyiqianduan\\tmp-uploads";
mkdirSync(TMP, { recursive: true });

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
  await page.waitForTimeout(320);
  await page.screenshot({ path: `${OUT}\\${name}.png` });
  console.log(`shot ${name} (${page.url()})`);
}

await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.screenshot({ path: `${TMP}\\tongue-demo.png`, clip: { x: 820, y: 260, width: 460, height: 340 } });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

// 陈素梅（第二行，有病史）
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator("table tbody tr").nth(1).locator("a").first().click(),
]);
await shot("50-r3c-patient-detail");

await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.getByRole("button", { name: /开始接诊|继续接诊/ }).first().click(),
]);
const visitUrl = page.url();

// 复诊：带入上次记录
await page.getByRole("button", { name: "带入上次记录（可修改）" }).click();
await page.waitForTimeout(600);
await page.locator("#chief").fill("入睡困难 3 月余，加重 2 周，伴心悸、多梦");

// 自定义舌象（新增后自动选中，不要再点一次否则会取消）
const tongue = page.locator('[role="group"][aria-label="舌象"]');
await tongue.locator('button:has-text("自定义")').first().click();
const tongueInput = tongue.locator("input");
await tongueInput.fill("舌质偏暗");
await tongueInput.press("Enter");
await page.waitForTimeout(1500);

// 上传舌象照片
await page.locator('input[type="file"]').first().setInputFiles(`${TMP}\\tongue-demo.png`);
await page.waitForTimeout(2200);
await shot("51-r3c-visit-revisit");

// 保存并签名
await page.getByRole("button", { name: "保存并签名" }).click();
await page.waitForTimeout(1800);
await shot("52-r3c-signed");

// 打印页
const visitId = visitUrl.split("/visits/")[1];
await page.goto(`${BASE}/print/prescription/${visitId}`, { waitUntil: "networkidle" });
await page.setViewportSize({ width: 559, height: 794 });
await shot("53-r3c-print");

// 患者详情：图片资料
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(`${BASE}/patients`, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator("table tbody tr").nth(1).locator("a").first().click(),
]);
await shot("54-r3c-patient-gallery");

await page.goto(`${BASE}/settings/vocabulary`, { waitUntil: "networkidle" });
await shot("55-r3c-vocabulary");

console.log("=== problems ===");
console.log(problems.length ? problems.slice(0, 8).join("\n") : "none");
await browser.close();
