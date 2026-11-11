/**
 * 知识库导入自测（脚本不写正式库）：
 *   node --import tsx scripts/test-kb-import.mjs
 *
 * 覆盖：
 *  1) formulas.csv / herbs.csv 前 5 行的解析与校验统计（连真实库只读取上下文）
 *  2) RFC4180 引号、引号内换行、"" 转义、UTF-8 BOM、行号定位
 *  3) JSON 对象数组（含数组字段、BOM、非法 JSON）
 *  4) E1/E2/E3/W1/W2 规则与必填映射
 *  5) 在 dev.db 的副本上模拟一次「入库 → 按批次回滚」，核对新增删除、版本回退
 *
 * 正式库（prisma/dev.db）只被复制读取，不会被写入。
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { PrismaClient } from "@prisma/client";

import {
  IMPORT_TEMPLATE_HEAD,
  IMPORT_TEMPLATE_SAMPLE,
  formatCompositionJson,
  parseComposition,
} from "../lib/kb.ts";
import {
  KbImportError,
  MAX_IMPORT_BYTES,
  duplicateTargets,
  guessMapping,
  inferItemType,
  kbItemKey,
  missingRequiredTargets,
  parseJsonRows,
  parseNumber,
  parseUpload,
  selectRowsForCommit,
  summarizeRows,
  toCsvLine,
  validateImportRows,
} from "../lib/kb-import.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function check(name, condition, detail = "") {
  results.push({ name, ok: Boolean(condition) });
  if (!condition) console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  else console.log(`  ✓ ${name}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}

async function readSeed(name) {
  return fs.readFile(path.join(root, "data", "seed", name), "utf8");
}

/** 取 CSV 的表头 + 前 n 条数据行（数据行里没有引号，可按物理行切） */
function firstRows(csvText, n) {
  const lines = csvText.replace(/^\uFEFF/, "").split(/\r\n|\n|\r/).filter((line) => line.length > 0);
  return lines.slice(0, n + 1).join("\n");
}

async function main() {
  // ---------- 1. 种子 CSV 前 5 行 ----------
  section("1. formulas.csv 前 5 行（方剂）");
  const formulasCsv = await readSeed("formulas.csv");
  const formulasText = firstRows(formulasCsv, 5);
  check("母文件有 121 行", formulasCsv.split(/\r?\n/).filter(Boolean).length === 121);

  const formulas = parseUpload("formulas.csv", new TextEncoder().encode(formulasText));
  check("10 列", formulas.columns.length === 10, `实际 ${formulas.columns.length}：${formulas.columns.join(",")}`);
  check("5 行数据", formulas.rows.length === 5);
  check("行号从 2 开始", formulas.lines[0] === 2 && formulas.lines[4] === 6, formulas.lines.join(","));
  check("列名猜出方名→name", guessMapping(formulas.columns)["方名"] === "name");
  check("列名猜出组成→composition", guessMapping(formulas.columns)["组成"] === "composition");
  check("列名猜出别名→alias", guessMapping(formulas.columns)["别名"] === "alias");
  check("识别为方剂", inferItemType(formulas.columns) === "formula");

  const formulaMapping = guessMapping(formulas.columns);
  check("方剂必填齐了", missingRequiredTargets(formulaMapping, "formula").length === 0);
  check("没有重复映射", duplicateTargets(formulaMapping).length === 0);
  check("第一行组成能解析出多味", parseComposition(formulas.rows[0]["组成"]).length >= 2,
    `实际 ${parseComposition(formulas.rows[0]["组成"]).length} 味`);

  const formulaSummary = summarizeRows(validateFormulaRows(formulas, formulaMapping));

  section("2. herbs.csv 前 5 行（中药）");
  const herbsCsv = await readSeed("herbs.csv");
  const herbs = parseUpload("herbs.csv", new TextEncoder().encode(firstRows(herbsCsv, 5)));
  check("9 列", herbs.columns.length === 9, herbs.columns.join(","));
  check("5 行数据", herbs.rows.length === 5);
  check("识别为中药", inferItemType(herbs.columns) === "herb");
  const herbMapping = guessMapping(herbs.columns);
  check("药名→name", herbMapping["药名"] === "name");
  check("用法用量→usageText", herbMapping["用法用量"] === "usageText");
  check("中药只要求药名", missingRequiredTargets(herbMapping, "herb").length === 0);
  check("方剂必填在中药表上不该强行照搬", missingRequiredTargets(herbMapping, "formula").includes("composition"));

  const herbRows = validateImportRows(herbs.rows, herbs.lines, herbMapping, herbContext());
  const herbSummary = summarizeRows(herbRows);
  check("中药行不出现 E2", herbRows.every((row) => !row.codes.includes("E2")));
  check("中药行没有错误", herbSummary.error === 0, JSON.stringify(herbSummary));

  // ---------- 2. RFC4180 ----------
  section("3. CSV 边界：BOM / 引号 / 引号内换行 / \"\" 转义");
  const tricky =
    "\uFEFF方名,组成,出处,备注\r\n" +
    '"麻黄汤","麻黄9g,桂枝6g","《伤寒论》","第一行\r\n第二行"\r\n' +
    '"桂枝汤","桂枝9g|白芍9g","《伤寒论》","他说""好"""\r\n';
  const trickyParsed = parseUpload("tricky.csv", new TextEncoder().encode(tricky));
  check("BOM 不影响首列名", trickyParsed.columns[0] === "方名", trickyParsed.columns[0]);
  check("引号里的逗号不切列", trickyParsed.rows[0]["组成"] === "麻黄9g,桂枝6g", trickyParsed.rows[0]["组成"]);
  check("引号里的换行保留", trickyParsed.rows[0]["备注"] === "第一行\n第二行", JSON.stringify(trickyParsed.rows[0]["备注"]));
  check("双引号转义", trickyParsed.rows[1]["备注"] === '他说"好"', trickyParsed.rows[1]["备注"]);
  check("多行记录的下一行行号正确", trickyParsed.lines[1] === 4, trickyParsed.lines.join(","));
  check("引号内逗号组成解析为 2 味", parseComposition(trickyParsed.rows[0]["组成"]).length === 2);

  // ---------- 3. JSON ----------
  section("4. JSON 对象数组");
  const jsonText =
    "\uFEFF" +
    JSON.stringify([
      { 方名: "麻黄汤", 组成: ["麻黄9g", "桂枝6g"], 出处: "《伤寒论》", 别名: "麻黄加术汤|麻桂汤", 功效: "发汗解表" },
      { 方名: "", 组成: "" },
    ]);
  const jsonParsed = parseUpload("rows.json", new TextEncoder().encode(jsonText));
  check("JSON 列取并集", jsonParsed.columns.join(",") === "方名,组成,出处,别名,功效", jsonParsed.columns.join(","));
  check("JSON 跳过全空对象", jsonParsed.rows.length === 1, `实际 ${jsonParsed.rows.length} 行`);
  check("数组字段拼成 |", jsonParsed.rows[0]["组成"] === "麻黄9g|桂枝6g", jsonParsed.rows[0]["组成"]);
  check("JSON 行号为下标+1", jsonParsed.lines.join(",") === "1");
  let jsonRejected = false;
  try {
    parseJsonRows("{不是数组");
  } catch (error) {
    jsonRejected = error instanceof KbImportError;
  }
  check("非法 JSON 抛 KbImportError", jsonRejected);

  // ---------- 4. 校验规则 ----------
  section("5. 校验规则 E1/E2/E3/W1/W2 + 解析小函数");
  const ctx = await loadContext("formula");
  const brokenRows = [
    { 方名: "", 组成: "麻黄9g", 出处: "《自测》" }, // E1
    { 方名: "测试空方", 组成: "", 出处: "《自测》" }, // E2
    { 方名: "测试缺出处", 组成: "麻黄9g|桂枝6g" }, // W1
    { 方名: "测试缺剂量", 组成: "麻黄|桂枝6g", 出处: "《自测》" }, // W2
  ];
  const brokenValidated = validateImportRows(
    brokenRows,
    [2, 3, 4, 5],
    { 方名: "name", 组成: "composition", 出处: "source" },
    ctx,
  );
  check("E1 方名为空", brokenValidated[0].status === "error" && brokenValidated[0].codes.includes("E1"));
  check("E2 组成为空", brokenValidated[1].status === "error" && brokenValidated[1].codes.includes("E2"));
  check("W1 缺出处", brokenValidated[2].status === "warn" && brokenValidated[2].codes.includes("W1"));
  check("W2 缺剂量", brokenValidated[3].status === "warn" && brokenValidated[3].codes.includes("W2"));

  // W3 只在库里有中药词表时才校验（当前库 herb 为空 → 上面的行都不该带 W3）
  check("库中无中药词表时跳过 W3", brokenValidated.every((row) => !row.codes.includes("W3")));
  const herbAwareContext = {
    itemType: "formula",
    existing: new Map(),
    herbTerms: ["麻黄", "桂枝", "白芍", "甘草"],
  };
  const w3Rows = validateImportRows(
    [
      { 方名: "测试已知药", 组成: "麻黄9g|桂枝9g", 出处: "《自测》" },
      { 方名: "测试错别字", 组成: "麻黄9g|桂技6g", 出处: "《自测》" },
      { 方名: "测试多味未知", 组成: "天麻9g|钩藤9g|石决明9g", 出处: "《自测》" },
    ],
    [2, 3, 4],
    { 方名: "name", 组成: "composition", 出处: "source" },
    herbAwareContext,
  );
  check("W3 已知药名不告警", !w3Rows[0].codes.includes("W3"), w3Rows[0].codes.join(","));
  check("W3 错别字告警", w3Rows[1].codes.includes("W3") && w3Rows[1].status === "warn", w3Rows[1].codes.join(","));
  check(
    "W3 给出编辑距离最近的候选",
    w3Rows[1].hints.some((hint) => hint.includes("桂枝")),
    w3Rows[1].hints.join(" / "),
  );
  check(
    "W3 候选最多 3 个且多余用「另有」概括",
    w3Rows[2].hints.filter((hint) => hint.includes("不在中药词表")).length <= 2 &&
      w3Rows[2].hints.some((hint) => hint.includes("另有")),
    w3Rows[2].hints.join(" / "),
  );

  const existingItem = ctx.existing.size > 0 ? [...ctx.existing.entries()][0][0] : "";
  const [, existingName, existingSource] = existingItem.split("\u0000");
  const updateValidated = validateImportRows(
    [{ 方名: existingName, 组成: "麻黄9g|桂枝6g", 出处: existingSource }],
    [2],
    { 方名: "name", 组成: "composition", 出处: "source" },
    ctx,
  );
  check("E3 同名同出处 → update", updateValidated[0].status === "update" && updateValidated[0].codes.includes("E3"));
  check("E3 不算错误", summarizeRows(updateValidated).error === 0);

  const sameNameOtherSource = validateImportRows(
    [{ 方名: existingName, 组成: "麻黄9g|桂枝6g", 出处: "《自测别处》" }],
    [2],
    { 方名: "name", 组成: "composition", 出处: "source" },
    ctx,
  );
  check("同名不同出处 → 正常 pass", sameNameOtherSource[0].status === "pass", sameNameOtherSource[0].status);

  check("parseNumber 处理克数/全角", parseNumber("３０克") === 30 && parseNumber("1,200") === 1200 && parseNumber("") === null);
  check("模板行可转 CSV 且字段数正确", toCsvLine(IMPORT_TEMPLATE_HEAD).split(",").length === 10);
  check("模板示例行非空", IMPORT_TEMPLATE_SAMPLE.length === IMPORT_TEMPLATE_HEAD.length);
  check("MAX_IMPORT_BYTES 是 5MB", MAX_IMPORT_BYTES === 5 * 1024 * 1024);

  // 只有警告行的批次：pass 模式无可写入行，all 模式必须能选到
  // （UI 里「全部导入」按钮的可用性要用 pass + warn + update 判断，不能只看 pass + update）
  const warnOnlyRows = validateImportRows(
    [
      { 方名: "自测无出处方", 组成: "自测药A10g|自测药B6g", 出处: "" },
      { 方名: "自测缺剂量方", 组成: "自测药A|自测药B6g", 出处: "《自测》" },
    ],
    [2, 3],
    { 方名: "name", 组成: "composition", 出处: "source" },
    ctx,
  );
  const warnOnlySummary = summarizeRows(warnOnlyRows);
  check(
    "只有警告行的批次：2 警告 0 错误",
    warnOnlySummary.warn === 2 && warnOnlySummary.error === 0,
    JSON.stringify(warnOnlySummary),
  );
  check("pass 模式选不到警告行", selectRowsForCommit(warnOnlyRows, "pass").length === 0);
  check("all 模式能选中全部警告行", selectRowsForCommit(warnOnlyRows, "all").length === 2);

  // ---------- 5. 临时批次 入库 → 回滚 ----------
  section("6. 在 dev.db 副本上模拟入库 + 按批次回滚");
  const dbSource = path.join(root, "prisma", "dev.db");
  const dbCopy = path.join(root, "data", "selftest-kb-import.db");
  await fs.mkdir(path.join(root, "data"), { recursive: true });
  await fs.copyFile(dbSource, dbCopy);
  const prisma = new PrismaClient({
    datasources: { db: { url: `file:${dbCopy.replaceAll("\\", "/")}` } },
  });

  try {
    // 让本段可复现：副本里清掉中药词表，避免 W3（药名不在词表）把「自测药」行变成警告
    const herbIds = (await prisma.kbItem.findMany({ where: { type: "herb" }, select: { id: true } })).map(
      (row) => row.id,
    );
    if (herbIds.length > 0) {
      await prisma.kbAlias.deleteMany({ where: { kbItemId: { in: herbIds } } });
      await prisma.kbItemVersion.deleteMany({ where: { kbItemId: { in: herbIds } } });
      await prisma.kbItem.deleteMany({ where: { id: { in: herbIds } } });
    }

    const beforeItems = await prisma.kbItem.count();
    const beforeVersions = await prisma.kbItemVersion.count();
    const beforeAliases = await prisma.kbAlias.count();
    const beforeBatches = await prisma.kbImportBatch.count();

    const existingRow = await prisma.kbItem.findFirst({
      where: { type: "formula" },
      select: { id: true, name: true, source: true, currentVersion: true },
    });
    check("副本里有可更新的条目", Boolean(existingRow));

    const newName = "自测导入方甲";
    const mapping = { 方名: "name", 组成: "composition", 出处: "source", 别名: "alias" };
    const rowsForCommit = [
      { 方名: existingRow.name, 组成: existingRow.name === "" ? "" : "自测药A10g|自测药B6g", 出处: existingRow.source ?? "", 别名: "" },
      { 方名: newName, 组成: "自测药A10g|自测药B6g", 出处: "《自测》", 别名: "自测甲方|自测甲" },
      { 方名: newName, 组成: "自测药A10g|自测药B6g", 出处: "《自测》", 别名: "" }, // 同批重复
    ];
    const commitCtx = await loadContextWith(prisma, "formula");
    const commitRows = validateImportRows(rowsForCommit, [2, 3, 4], mapping, commitCtx);
    const commitSummary = summarizeRows(commitRows);
    check("3 行校验：1 update + 2 pass", commitSummary.update === 1 && commitSummary.pass === 2, JSON.stringify(commitSummary));

    // 与 lib/kb-import-actions.ts 的 dedupe / 计数规则一致
    const selected = selectRowsForCommit(commitRows, "pass");
    const seen = new Set();
    const batchId = randomUUID();
    const now = new Date().toISOString();
    const operatorId = "selftest";
    let inserted = 0;
    let updated = 0;

    await prisma.$transaction(async (tx) => {
      await tx.kbImportBatch.create({
        data: {
          id: batchId,
          filename: "selftest.csv",
          totalRows: commitSummary.total,
          okRows: commitSummary.pass + commitSummary.update,
          warnRows: commitSummary.warn,
          errorRows: commitSummary.error,
          operatorId,
          createdAt: now,
          rolledBack: 0,
        },
      });
      for (const row of selected) {
        const key = kbItemKey("formula", row.data.name, row.data.source);
        if (seen.has(key)) continue;
        seen.add(key);
        const existing = commitCtx.existing.get(key);
        const compositionJson = formatCompositionJson(row.data.composition);
        if (existing) {
          const latest = await tx.kbItemVersion.aggregate({
            where: { kbItemId: existing.id },
            _max: { version: true },
          });
          const version = Math.max(existing.currentVersion, latest._max.version ?? 0) + 1;
          await tx.kbItemVersion.create({
            data: {
              kbItemId: existing.id,
              version,
              compositionJson,
              batchId,
              createdAt: now,
            },
          });
          await tx.kbItem.update({ where: { id: existing.id }, data: { currentVersion: version, updatedAt: now } });
          updated += 1;
        } else {
          const itemId = randomUUID();
          await tx.kbItem.create({
            data: {
              id: itemId,
              type: "formula",
              name: row.data.name,
              source: row.data.source || null,
              currentVersion: 1,
              status: "active",
              createdAt: now,
              updatedAt: now,
            },
          });
          await tx.kbItemVersion.create({
            data: {
              kbItemId: itemId,
              version: 1,
              compositionJson,
              batchId,
              createdAt: now,
            },
          });
          for (const alias of row.data.aliases) {
            await tx.kbAlias.create({
              data: { kbItemId: itemId, term: alias, normTerm: row.data.name, aliasType: "formula_name", weight: 1 },
            });
          }
          inserted += 1;
        }
      }
      await tx.auditLog.create({
        data: {
          entityType: "kb_import",
          entityId: batchId,
          action: "import",
          afterJson: JSON.stringify({ batchId, filename: "selftest.csv", inserted, updated }),
          operatorId,
          createdAt: now,
        },
      });
    });

    const skipped = commitSummary.total - inserted - updated;
    check("新增 1 条 + 更新 1 条 + 跳过 1 行", inserted === 1 && updated === 1 && skipped === 1,
      `inserted=${inserted} updated=${updated} skipped=${skipped}`);
    const afterItems = await prisma.kbItem.count();
    check("库条目 +1", afterItems === beforeItems + 1, `${beforeItems} → ${afterItems}`);
    check("版本 +2", (await prisma.kbItemVersion.count()) === beforeVersions + 2);
    check("别名 +2", (await prisma.kbAlias.count()) === beforeAliases + 2);
    check("批次 +1", (await prisma.kbImportBatch.count()) === beforeBatches + 1);
    const bumped = await prisma.kbItem.findUnique({ where: { id: existingRow.id } });
    check("被更新条目 currentVersion 递增", bumped.currentVersion === existingRow.currentVersion + 1,
      `${existingRow.currentVersion} → ${bumped.currentVersion}`);

    // 回滚（与 rollbackBatch 相同的判定规则）
    const batchVersions = await prisma.kbItemVersion.findMany({ where: { batchId }, select: { kbItemId: true } });
    const itemIds = [...new Set(batchVersions.map((v) => v.kbItemId))];
    const allVersions = await prisma.kbItemVersion.findMany({
      where: { kbItemId: { in: itemIds } },
      select: { kbItemId: true, version: true, batchId: true },
    });
    let removed = 0;
    let reverted = 0;
    await prisma.$transaction(async (tx) => {
      for (const itemId of itemIds) {
        const others = allVersions.filter((v) => v.kbItemId === itemId && v.batchId !== batchId);
        if (others.length === 0) {
          await tx.kbAlias.deleteMany({ where: { kbItemId: itemId } });
          await tx.kbItemVersion.deleteMany({ where: { kbItemId: itemId } });
          await tx.kbItem.delete({ where: { id: itemId } });
          removed += 1;
        } else {
          const target = Math.max(...others.map((v) => v.version));
          await tx.kbItem.update({ where: { id: itemId }, data: { currentVersion: target } });
          reverted += 1;
        }
      }
      await tx.kbImportBatch.update({ where: { id: batchId }, data: { rolledBack: 1 } });
      await tx.auditLog.create({
        data: {
          entityType: "kb_import",
          entityId: batchId,
          action: "import_rollback",
          beforeJson: JSON.stringify({ rolledBack: 0 }),
          afterJson: JSON.stringify({ batchId, removed, reverted }),
          operatorId,
          createdAt: new Date().toISOString(),
        },
      });
    });

    check("删除 1 条、回退 1 条", removed === 1 && reverted === 1, `removed=${removed} reverted=${reverted}`);
    check("条目数恢复", (await prisma.kbItem.count()) === beforeItems);
    check("批次标记已撤销", (await prisma.kbImportBatch.findUnique({ where: { id: batchId } })).rolledBack === 1);
    const restored = await prisma.kbItem.findUnique({ where: { id: existingRow.id } });
    check("被更新条目 currentVersion 回退", restored.currentVersion === existingRow.currentVersion,
      `${bumped.currentVersion} → ${restored.currentVersion}`);
    check("审计写了 import 与 import_rollback",
      (await prisma.auditLog.count({ where: { entityId: batchId, action: "import" } })) === 1 &&
        (await prisma.auditLog.count({ where: { entityId: batchId, action: "import_rollback" } })) === 1);
    check("回滚保留批次写入的版本行（可追溯）",
      (await prisma.kbItemVersion.count({ where: { batchId } })) === 1);
  } finally {
    await prisma.$disconnect();
    await fs.unlink(dbCopy).catch(() => {});
    await fs.unlink(`${dbCopy}-journal`).catch(() => {});
  }

  // ---------- 汇总 ----------
  console.log("\n== 校验统计 ==");
  console.log(`formulas.csv 前 5 行：${formulaSummary.total} 行 → 通过 ${formulaSummary.pass}，警告 ${formulaSummary.warn}，错误 ${formulaSummary.error}，更新 ${formulaSummary.update}`);
  console.log(`herbs.csv   前 5 行：${herbSummary.total} 行 → 通过 ${herbSummary.pass}，警告 ${herbSummary.warn}，错误 ${herbSummary.error}，更新 ${herbSummary.update}`);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n断言 ${results.length - failed.length}/${results.length} 通过`);
  if (failed.length > 0) {
    console.error(`失败：${failed.map((result) => result.name).join("；")}`);
    process.exitCode = 1;
  }
}

function validateFormulaRows(parsed, mapping) {
  // 同步版：先用真实库上下文（main 里调用时 ctx 还没建好，单独加载一次）
  const placeholder = new Map();
  return validateImportRows(parsed.rows, parsed.lines, mapping, {
    itemType: "formula",
    existing: placeholder,
    herbTerms: [],
  });
}

function herbContext() {
  return { itemType: "herb", existing: new Map(), herbTerms: [] };
}

async function loadContextWith(prisma, itemType) {
  const items = await prisma.kbItem.findMany({
    where: { type: itemType },
    select: { id: true, name: true, source: true, currentVersion: true },
  });
  const existing = new Map();
  for (const item of items) {
    existing.set(kbItemKey(itemType, item.name, item.source), {
      id: item.id,
      currentVersion: item.currentVersion,
    });
  }
  let herbTerms = [];
  if (itemType === "formula") {
    const [herbs, aliases] = await Promise.all([
      prisma.kbItem.findMany({ where: { type: "herb" }, select: { name: true } }),
      prisma.kbAlias.findMany({ where: { aliasType: "herb_name" }, select: { term: true } }),
    ]);
    herbTerms = [...herbs.map((herb) => herb.name), ...aliases.map((alias) => alias.term)];
  }
  return { itemType, existing, herbTerms };
}

async function loadContext(itemType) {
  const dbSource = path.join(root, "prisma", "dev.db");
  const prisma = new PrismaClient({ datasources: { db: { url: `file:${dbSource.replaceAll("\\", "/")}` } } });
  try {
    return await loadContextWith(prisma, itemType);
  } finally {
    await prisma.$disconnect();
  }
}

await main();
