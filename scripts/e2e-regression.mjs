/**
 * 端到端回归：登录 → 患者（卡号搜索/新建）→ 接诊台（录入/签名）→ 打印 →
 * 知识库浮层（检索/带入）→ 医案 → 古籍正文检索 → 整本病历 → 设置（打印版式）
 * 用法：node scripts/e2e-regression.mjs [baseUrl]
 */
import { chromium } from "playwright-core";

const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = process.argv[2] ?? "http://127.0.0.1:3100";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const stamp = String(Date.now()).slice(-6);
const patientName = `回归测试${stamp}`;
const cardNo = `T${stamp}`;

try {
  // 1 登录
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.fill('input[name="username"]', "doctor");
  await page.fill('input[name="password"]', "doctor1234");
  await Promise.all([
    page.waitForURL("**/patients", { timeout: 20000 }),
    page.locator('form:has(input[name="username"]) button[type="submit"]').click(),
  ]);
  check("登录进入患者列表", page.url().endsWith("/patients"));

  // 2 卡号搜索（已有演示数据 A0002）
  await page.locator('input[placeholder*="拼音首字母"]').fill("A0002");
  await page.waitForTimeout(500);
  const searchRows = await page.locator("table tbody tr").count();
  check("按卡号搜索命中 1 位", searchRows === 1, `rows=${searchRows}`);
  await page.locator('input[placeholder*="拼音首字母"]').fill("");

  // 3 新建患者（带卡号）
  await page.goto(`${BASE}/patients/new`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.fill('input[name="name"]', patientName);
  await page.selectOption('select[name="gender"]', "female");
  await page.fill('input[name="birthYear"]', "1988");
  await page.fill('input[name="phone"]', `139${stamp}00`);
  await page.fill('input[name="cardNo"]', cardNo);
  await Promise.all([
    page.waitForURL(/\/patients\/[0-9a-f-]{36}$/, { timeout: 25000 }),
    page.locator('form:has(input[name="name"]) button[type="submit"]').click(),
  ]);
  const patientUrl = page.url();
  check("新建患者并进入详情", /\/patients\/[0-9a-f-]{36}$/.test(patientUrl), patientUrl);
  await page.waitForTimeout(1500);
  const cardText = await page.locator("body").innerText();
  check("详情显示门诊卡号", cardText.includes(cardNo));

  // 4 开始接诊 → 录入 → 保存并签名
  await Promise.all([
    page.waitForURL(/\/visits\/[0-9a-f-]{36}$/, { timeout: 25000 }),
    page.locator('button:has-text("开始接诊")').first().click(),
  ]);
  await page.waitForTimeout(1500);
  const visitUrl = page.url();
  check("进入接诊台", /\/visits\/[0-9a-f-]{36}$/.test(visitUrl), visitUrl);

  await page.fill("#chief", "入睡困难 3 月余，加重 2 周");
  await page.fill("#present", "每晚入睡需 1-2 小时，夜醒 2 次，伴心悸多梦。");
  await page.locator('[data-kb-stop] button:has-text("心脾两虚")').first().click();
  await page.waitForTimeout(300);
  const treatment = await page.inputValue("#treatment");
  check("点证型自动带出治法", treatment.includes("益气补血"), treatment);

  const herbInputs = page.locator('input[aria-label$="味药名"]');
  await herbInputs.nth(0).fill("黄芪");
  await page.locator('input[aria-label$="味剂量"]').nth(0).fill("30");
  await herbInputs.nth(1).fill("当归");
  await page.locator('input[aria-label$="味剂量"]').nth(1).fill("12");
  await page.fill('input[id="doses"] , input#doses', "7").catch(() => {});
  await page.waitForTimeout(400);

  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/visits/") && r.status() === 200, { timeout: 25000 }).catch(() => null),
    page.locator('button:has-text("保存并签名")').click(),
  ]);
  await page.waitForTimeout(2500);
  const saved = await page.locator("body").innerText();
  check("保存并签名成功", saved.includes("已保存第 1 版") || saved.includes("已保存并签名"));

  // 5 打印页
  const visitId = visitUrl.split("/").pop();
  const printResp = await page.goto(`${BASE}/print/prescription/${visitId}`, { waitUntil: "networkidle" });
  check("处方打印页可打开", printResp?.status() === 200, `status=${printResp?.status()}`);
  const printText = await page.locator("body").innerText();
  check("打印页有患者与处方", printText.includes(patientName) && printText.includes("黄芪"));

  // 6 存为医案
  await page.goto(visitUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(2000);
  const caseBtn = page.locator('button:has-text("存为医案")');
  if (await caseBtn.count()) {
    await caseBtn.first().click();
    await page.waitForTimeout(2000);
    const toast = await page.locator("body").innerText();
    check("存为医案", toast.includes("已存为医案") || toast.includes("已经有同名医案"));
  } else {
    check("存为医案按钮存在", false);
  }

  // 7 知识库浮层检索 + 带入
  await page.goto(`${BASE}/visits/${visitId}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1600);
  await page.keyboard.press("Control+k");
  await page.waitForTimeout(1200);
  await page.keyboard.type("归脾");
  await page.waitForTimeout(1200);
  const overlayText = await page.locator("body").innerText();
  check("Ctrl+K 检索到归脾汤", overlayText.includes("归脾汤"));
  await page.keyboard.press("Escape");

  // 8 古籍正文检索
  await page.goto(`${BASE}/kb`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  await page.locator("button", { hasText: /^古籍/ }).first().click();
  await page.waitForTimeout(600);
  const bodyToggle = page.locator('button:has-text("搜正文")');
  if (await bodyToggle.count()) {
    await bodyToggle.first().click();
    await page.waitForTimeout(300);
    await page.locator('input[placeholder*="书名"]').fill("乳香去油净没药去油净龙骨");
    await page.waitForTimeout(1800);
    const hitText = await page.locator("body").innerText();
    check("古籍正文检索命中大书", hitText.includes("医宗金鉴"));
  } else {
    check("古籍搜正文开关存在", false);
  }

  // 9 整本病历检索
  await page.goto(`${BASE}/records?q=${encodeURIComponent("入睡困难")}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const recordsText = await page.locator("body").innerText();
  check("整本病历检索有结果", recordsText.includes("找到"));

  // 10 设置：打印版式可保存
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  const printForm = page.locator("form:has(select[name='paper'])");
  check("设置页有打印版式", (await printForm.count()) === 1);
  await printForm.locator("button[type='submit']").click();
  await page.waitForTimeout(1500);
  const settingsText = await page.locator("body").innerText();
  check("打印版式保存有反馈", settingsText.includes("已保存"));
} catch (error) {
  check("脚本执行未抛错", false, String(error).slice(0, 300));
} finally {
  const realErrors = errors.filter((text) => !/favicon|Download the React DevTools/i.test(text));
  check("页面无 console 错误", realErrors.length === 0, realErrors.slice(0, 3).join(" | "));
  await browser.close();
}

const failed = results.filter((item) => !item.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 通过 ===`);
if (failed.length) {
  console.log("失败项：" + failed.map((item) => item.name).join("、"));
  process.exitCode = 1;
}
