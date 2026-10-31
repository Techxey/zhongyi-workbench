import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:3100";
const SHOTS = "D:\\zhongyiqianduan\\screenshots";

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const problems = [];
page.on("console", (message) => {
  if (message.type() === "error") problems.push(`console: ${message.text()}`);
});
page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

const shot = async (name) => {
  await page.waitForTimeout(180);
  await page.screenshot({ path: `${SHOTS}\\${name}.png` });
  console.log(`shot ${name} (${page.url()})`);
};

// 1. 登录
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[name="username"]', "doctor");
await page.fill('input[name="password"]', "doctor1234");
await Promise.all([
  page.waitForURL("**/patients", { timeout: 20000 }),
  page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
]);

// 2. 建一个初诊患者
await page.goto(`${BASE}/patients/new`, { waitUntil: "networkidle" });
await page.fill('input[name="name"]', "陈素梅");
await page.selectOption('select[name="gender"]', "女");
await page.fill('input[name="birthYear"]', "1979");
await page.fill('input[name="phone"]', "13600008888");
await page.selectOption('select[name="constitution"]', { label: "气虚质" });
await page.fill('textarea[name="allergy"]', "否认药物过敏");
await page.fill('textarea[name="pastHistory"]', "甲状腺功能减退 3 年，服左甲状腺素钠片 50μg qd。");
await Promise.all([
  page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('form:has(input[name="name"]) button[type="submit"]').click(),
]);
const patientUrl = page.url();
console.log("patient:", patientUrl);

// 3. 进接诊台
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('form:has(button:has-text("开始接诊")) button[type="submit"]').first().click(),
]);
await page.waitForLoadState("networkidle");
await shot("20-r2-visit-empty");

// 4. 填病历
await page.fill("#chief", "入睡困难 3 月余，加重 2 周");
await page.fill(
  "#present",
  "近 3 月反复失眠，入睡需 1-2 小时，夜间易醒 2-3 次，伴心悸、多梦、醒后乏力；近 2 周工作压力增大后加重，白天注意力下降。",
);

const symptomSection = page.locator("section").nth(2);
const chipTexts = (await symptomSection.locator('button[aria-pressed]').allInnerTexts()).map((text) => text.trim());
console.log("symptom chips:", chipTexts.join(","));
const wanted = ["入睡困难", "多梦", "心悸", "乏力", "易醒", "纳差"].filter((term) => chipTexts.includes(term));
for (const term of wanted.slice(0, 5)) {
  await symptomSection.locator(`button[aria-pressed="false"]:has-text("${term}")`).first().click();
}

await page.locator('[aria-label="舌象"] button[aria-pressed="false"]:has-text("舌淡红")').first().click();
await page.locator('[aria-label="舌象"] button[aria-pressed="false"]:has-text("苔薄白")').first().click();
await page.locator('[aria-label="脉象"] button[aria-pressed="false"]:has-text("脉细")').first().click();

// 证型候选：填完现病史/要点后应出现「心脾两虚」，点选自动带治法
const candidate = page
  .locator("section")
  .nth(4)
  .locator('button[aria-pressed="false"]:has-text("心脾两虚")')
  .first();
await candidate.waitFor({ timeout: 5000 });
await candidate.click();
const treatment = await page.inputValue("#treatment");
console.log("treatment auto:", treatment);

await page.fill("#advice", "少思虑，忌浓茶咖啡；睡前热水泡脚。");
const herbRows = await page.locator('li:has(input[aria-label$="味药名"])').count();
console.log("herb rows:", herbRows);

const herbs = [
  ["黄芪", "30"],
  ["党参", "15"],
  ["白术", "15"],
  ["茯神", "15"],
  ["当归", "12"],
  ["远志", "6"],
  ["酸枣仁", "20"],
  ["龙眼肉", "12"],
  ["木香", "6"],
  ["炙甘草", "6"],
];
for (const [index, [name, dose]] of herbs.entries()) {
  const row = page.locator('li:has(input[aria-label$="味药名"])').nth(index);
  await row.locator('input[aria-label$="味药名"]').fill(name);
  await row.locator('input[aria-label$="味剂量"]').fill(dose);
}
await page.fill('input[placeholder="方名（可手填）"]', "归脾汤");
await shot("21-r2-visit-filled");

// 5. 保存并签名
await Promise.all([
  page.waitForResponse((response) => response.request().method() === "POST", { timeout: 20000 }),
  page.locator('button:has-text("保存并签名")').click(),
]);
await page.waitForTimeout(1200);
await shot("22-r2-visit-saved");
const statusText = await page.locator("header, body").first().innerText();
console.log("has 已保存:", statusText.includes("已保存"));

// 6. 打印页 A5
const visitUrl = page.url();
const visitId = visitUrl.split("/").pop();
const printPage = await ctx.newPage();
await printPage.setViewportSize({ width: 559, height: 794 });
await printPage.goto(`${BASE}/print/prescription/${visitId}`, { waitUntil: "networkidle" });
await printPage.screenshot({ path: `${SHOTS}\\23-r2-print.png`, fullPage: true });
console.log("shot 23-r2-print", await printPage.title());
await printPage.close();

// 7. 复诊：带入上次记录
await page.goto(patientUrl, { waitUntil: "networkidle" });
await Promise.all([
  page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 20000 }),
  page.locator('form:has(button:has-text("开始接诊")) button[type="submit"]').first().click(),
]);
await page.waitForLoadState("networkidle");
await page.locator('button:has-text("带入上次记录")').click();
await page.waitForTimeout(300);
await shot("24-r2-revisit");
const chiefAfter = await page.inputValue("#chief");
const herbFirst = await page.locator('li:has(input[aria-label$="味药名"])').first().locator('input[aria-label$="味药名"]').inputValue();
const diffText = await page.locator("section:has-text('较上次处方')").last().innerText();
console.log("初次带入 chief kept empty:", chiefAfter === "", "| first herb:", herbFirst, "| diff:", diffText.replace(/\s+/g, " ").slice(0, 80));

// 8. 修订：回到第一张已签病历再保存
await page.goto(visitUrl, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
await shot("25-r2-amend");
const amendBar = await page.locator("text=修订原因必填").count();
console.log("amend bar:", amendBar > 0);

// 9. 键盘流：Tab 顺序
await page.goto(`${BASE}/visits/${visitId}`, { waitUntil: "networkidle" });
await page.locator("#chief").click();
const order = [];
for (let i = 0; i < 6; i += 1) {
  await page.keyboard.press("Tab");
  order.push(
    await page.evaluate(() => {
      const el = document.activeElement;
      if (!el) return "none";
      return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}:${(el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").slice(0, 12)}`;
    }),
  );
}
console.log("tab order:", order.join(" -> "));

// 10. 校验：清空主诉后保存按钮禁用（已签病历页主按钮文案是「保存修订」）
await page.fill("#chief", "");
await page.waitForTimeout(200);
const saveBtn = page.locator("button.btn-primary").first();
const disabled = await saveBtn.isDisabled();
const saveLabel = (await saveBtn.innerText()).trim();
const waitText = await page.locator("text=待补").count();
console.log("save disabled:", disabled, "| save label:", saveLabel, "| 待补 hint:", waitText > 0);

console.log("=== problems ===");
console.log(problems.length === 0 ? "none" : problems.join("\n"));
await browser.close();
