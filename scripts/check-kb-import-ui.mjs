/**
 * 知识库导入向导 UI 自检（临时脚本）：
 *   node scripts/check-kb-import-ui.mjs
 *
 * 真实走一遍：登录 → /kb/import → 上传 CSV → 字段映射 → 校验 → 全部导入 → 撤销本批次，
 * 并在导入/撤销前后对比数据库计数（应完全恢复）。截图存 screenshots/。
 */

import path from "node:path";
import os from "node:os";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright-core";
import { PrismaClient } from "@prisma/client";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = "http://127.0.0.1:3100";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const SHOTS = path.join(root, "screenshots");
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(SHOTS, name), fullPage: true });
}

async function counts(prisma) {
  const [items, versions, aliases, batches] = await Promise.all([
    prisma.kbItem.count(),
    prisma.kbItemVersion.count(),
    prisma.kbAlias.count(),
    prisma.kbImportBatch.count(),
  ]);
  return { items, versions, aliases, batches };
}

const CSV = [
  "方名,别名,出处,组成,功效,主治,用法,禁忌,方解,备注",
  '自测导入测试方甲,自测甲方,《自测》,《自测药A10g|自测药B6g》,测试功效,,水煎服,,,界面自检行',
  "自测导入测试方乙,,,自测药A10g|自测药B6g,测试功效,,,,",
].join("\r\n");

async function main() {
  await fs.mkdir(SHOTS, { recursive: true });
  const csvPath = path.join(os.tmpdir(), "kb-import-ui-selftest.csv");
  await fs.writeFile(csvPath, CSV, "utf8");

  const prisma = new PrismaClient();
  const before = await counts(prisma);

  const browser = await chromium.launch({ executablePath: EDGE, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const dialogs = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.accept();
  });

  try {
    // 登录
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.fill("#username", "doctor");
    await page.fill("#password", "doctor1234");
    await Promise.all([page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 }), page.click('button[type="submit"]')]);
    check("登录成功", !page.url().includes("/login"), page.url());

    // 模板下载
    const template = await context.request.get(`${BASE}/api/kb/template`);
    const templateBody = await template.text();
    check("模板接口 200", template.status() === 200, String(template.status()));
    check("模板带 BOM", templateBody.charCodeAt(0) === 0xfeff);
    check("模板文件名", (template.headers()["content-disposition"] ?? "").includes('filename="kb-template.csv"'),
      template.headers()["content-disposition"]);
    check("模板两行", templateBody.replace(/^\uFEFF/, "").trim().split(/\r?\n/).length === 2);

    // 向导第 1 步
    await page.goto(`${BASE}/kb/import`, { waitUntil: "domcontentloaded" });
    await page.getByText("选择要导入的文件").waitFor({ timeout: 60_000 });
    check("页面标题为知识库 / 导入", (await page.title()).includes("知识库导入"), await page.title());
    check("面包屑有返回知识库", (await page.getByRole("link", { name: "返回知识库" }).count()) === 1);
    check("步骤条 3 步", (await page.getByText("1 上传").count()) === 1 && (await page.getByText("3 校验入库").count()) === 1);
    await shot(page, "kb-import-01-upload.png");

    // dev 模式首次编译时 React 可能还没 hydrate，直接 setInputFiles 会丢 change 事件；
    // 这里在 setInputFiles 之后轮询补发 change，直到预览出现（等 React 挂上 onChange）。
    await page.locator('input[type="file"]').setInputFiles(csvPath);
    let previewShown = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      if ((await page.getByText("已选择：").count()) > 0) {
        previewShown = true;
        break;
      }
      await page.evaluate(() => {
        const input = document.querySelector('input[type="file"]');
        if (input) input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await page.waitForTimeout(1000);
    }
    if (!previewShown) {
      const errorText = await page.locator(".field-error").allInnerTexts().catch(() => []);
      const cardText = await page.locator("section").first().innerText().catch(() => "");
      console.error("上传后页面未进入预览。错误文案：", errorText, "\n卡片内容：\n", cardText.slice(0, 1200));
      await shot(page, "kb-import-02a-upload-failed.png");
      throw new Error("文件上传后没有进入预览");
    }
    check("解析出 2 行", (await page.getByText("2 行", { exact: false }).count()) > 0);
    await shot(page, "kb-import-02-preview.png");

    // 第 2 步：字段映射（默认猜名）
    await page.getByRole("button", { name: "下一步：字段映射" }).click();
    await page.getByText("把文件里的列对应到知识库字段").waitFor({ timeout: 30_000 });
    const selects = page.locator("select");
    check("每列一个下拉", (await selects.count()) === 10, `实际 ${await selects.count()}`);
    const mapped = await selects.evaluateAll((nodes) => nodes.map((node) => node.value));
    check(
      "列名同义自动猜映射",
      JSON.stringify(mapped) ===
        JSON.stringify(["name", "alias", "source", "composition", "efficacy", "indication", "usageText", "contraindication", "commentary", "note"]),
      mapped.join(","),
    );
    check("必填字段标 *", (await selects.first().locator("option", { hasText: "方名 / 药名 *" }).count()) === 1);
    await shot(page, "kb-import-03-mapping.png");

    // 第 3 步：校验
    await page.getByRole("button", { name: "下一步：校验" }).click();
    await page.getByText("校验结果").waitFor({ timeout: 60_000 });
    const step3Text = await page.locator("section").first().innerText();
    check("汇总 2 行", step3Text.includes("共") && step3Text.includes("2"));
    check("1 通过 + 1 警告", step3Text.includes("警告"));
    check("逐行显示行号", (await page.getByText("第 2 行").count()) === 1 && (await page.getByText("第 3 行").count()) === 1);
    check("警告行有 W1", (await page.getByText("W1").count()) >= 1);
    await page.getByText("第 3 行").click();
    check("展开后显示代码文案", (await page.getByText("缺少出处").count()) >= 1);
    await shot(page, "kb-import-04-validate.png");

    // 全部导入（会弹 confirm，page.on dialog 自动接受）
    await page.getByRole("button", { name: "全部导入（警告行也入库）" }).click();
    await page.getByText("导入完成").waitFor({ timeout: 60_000 });
    check("导入前有 confirm 提示", dialogs.some((text) => text.includes("警告")), dialogs.join(" | "));
    const batchId = (await page.locator("span.select-all").first().innerText()).trim();
    check("返回批次号", /^[0-9a-f-]{36}$/.test(batchId), batchId);
    await shot(page, "kb-import-05-committed.png");

    const afterCommit = await counts(prisma);
    check("条目 +2", afterCommit.items === before.items + 2, `${before.items} → ${afterCommit.items}`);
    check("版本 +2", afterCommit.versions === before.versions + 2);
    check("别名 +1", afterCommit.aliases === before.aliases + 1, `${before.aliases} → ${afterCommit.aliases}`);
    check("批次 +1", afterCommit.batches === before.batches + 1);
    const savedItem = await prisma.kbItem.findFirst({ where: { name: "自测导入测试方甲" } });
    check("落库条目出处正确", savedItem?.source === "《自测》", String(savedItem?.source));

    // 撤销本批次
    await page.getByRole("button", { name: "撤销本批次" }).click();
    await page.getByText("已撤销批次").waitFor({ timeout: 60_000 });
    check("撤销有二次确认", dialogs.some((text) => text.includes("撤销")), dialogs.length > 0);
    await page.waitForTimeout(1200); // 等 router.refresh 把批次表刷新完
    const afterRollback = await counts(prisma);
    check("撤销后条目恢复", afterRollback.items === before.items, `${afterCommit.items} → ${afterRollback.items}`);
    check("撤销后版本恢复", afterRollback.versions === before.versions, `${afterCommit.versions} → ${afterRollback.versions}`);
    check("撤销后别名恢复", afterRollback.aliases === before.aliases, `${afterCommit.aliases} → ${afterRollback.aliases}`);
    check("撤销后批次仍留在台账", afterRollback.batches === before.batches + 1);
    check("撤销后批次标记", (await prisma.kbImportBatch.findUnique({ where: { id: batchId } }))?.rolledBack === 1);
    check("批次表显示已撤销", (await page.getByText("已撤销").count()) >= 1);
    check("已撤销批次的撤销按钮禁用", await page.locator('button:has-text("撤销")').last().isDisabled());
    await shot(page, "kb-import-06-rolled-back.png");

    const audits = await prisma.auditLog.findMany({
      where: { entityType: "kb_import", entityId: batchId },
      select: { action: true },
    });
    check(
      "审计写了 import 与 import_rollback",
      audits.length === 2 && audits.some((row) => row.action === "import") && audits.some((row) => row.action === "import_rollback"),
      audits.map((row) => row.action).join(","),
    );

    // 自检痕迹清理：audit_logs 有 BEFORE DELETE 触发器（只增表），审计留痕只能保留，
    // 所以这里只删批次台账行，把库恢复成自检前的状态。
    await prisma.kbImportBatch.deleteMany({ where: { id: batchId } });
    const cleaned = await counts(prisma);
    check(
      "批次台账已清理（审计只增表，留痕保留）",
      cleaned.items === before.items &&
        cleaned.versions === before.versions &&
        cleaned.aliases === before.aliases &&
        cleaned.batches === before.batches,
      JSON.stringify(cleaned),
    );
  } finally {
    await browser.close();
    await prisma.$disconnect();
    await fs.unlink(csvPath).catch(() => {});
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\n断言 ${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    console.error(`失败：${failed.map((result) => result.name).join("；")}`);
    process.exitCode = 1;
  }
}

await main();
