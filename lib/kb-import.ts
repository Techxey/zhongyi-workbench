/**
 * 知识库导入：CSV / JSON 解析、列名猜测、逐行校验。
 * 纯函数，不引用 next/* 与 prisma —— 导入向导（客户端）与导入动作（服务端）共用。
 *
 * 约定：
 * - CSV 按 RFC4180 解析（引号包裹、"" 转义、引号内换行），忽略 UTF-8 BOM；
 * - JSON 支持对象数组，也兼容 { rows: [...] } 这类外壳；
 * - 列名在文件里可以任意起，真正入库靠第 2 步的字段映射（见 IMPORT_TARGETS）。
 */

import {
  IMPORT_TARGETS,
  parseComposition,
  type ImportTargetKey,
  type RxComponent,
} from "./kb";

/** 单个导入文件上限：5MB（超过请拆分批次） */
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export const IMPORT_EXTENSIONS = [".csv", ".json"] as const;

export type ImportFileExtension = (typeof IMPORT_EXTENSIONS)[number];

/** 第 1 步预览最多展示多少行（校验与入库始终按全文处理） */
export const PREVIEW_ROW_LIMIT = 100;

export type ImportRow = Record<string, string>;

/** 导入的条目类型：本向导面向方剂与中药（医案/古籍的字段不同，不走批导） */
export type ImportItemType = "formula" | "herb";

export type ParsedUpload = {
  columns: string[];
  rows: ImportRow[];
  /** 每行在原文件里的行号：CSV 表头占第 1 行；JSON 为数组下标 + 1 */
  lines: number[];
};

/** 解析类错误直接带一句给医生看的话，动作层原样返回 */
export class KbImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KbImportError";
  }
}

export function fileExtension(name: string): string {
  const clean = name.trim();
  const dot = clean.lastIndexOf(".");
  return dot === -1 ? "" : clean.slice(dot).toLowerCase();
}

export function isImportExtension(ext: string): ext is ImportFileExtension {
  return (IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

/** 严格按 UTF-8 解码：解不出来返回 null（动作层提示另存为 CSV UTF-8） */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeCell(raw: string): string {
  return raw.replace(/\r\n?/g, "\n").trim();
}

/** 表头兜底：空列名给「列N」，重名给「列名 (2)」 */
function buildHeader(cells: string[]): string[] {
  const columns: string[] = [];
  const used = new Map<string, number>();
  cells.forEach((cell, index) => {
    let name = normalizeCell(cell).replace(/\s+/g, " ") || `列${index + 1}`;
    const seen = used.get(name) ?? 0;
    used.set(name, seen + 1);
    if (seen > 0) name = `${name} (${seen + 1})`;
    columns.push(name);
  });
  return columns;
}

function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r\n|\n|\r/)[0] ?? "";
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  if (tabs > 0 && tabs >= commas) return "\t";
  return ",";
}

/**
 * 把 CSV 文本切成「字段数组 + 起始行号」。
 * 引号里的换行不切行；行号用于第 3 步按文件真实行号定位问题行。
 */
function splitRecords(text: string, delimiter: string): { cells: string[]; line: number }[] {
  const records: { cells: string[]; line: number }[] = [];
  let cells: string[] = [];
  let field = "";
  let inQuotes = false;
  let started = false;
  let line = 1;
  let recordLine = 1;

  const pushField = () => {
    cells.push(field);
    field = "";
  };
  const pushRecord = () => {
    pushField();
    records.push({ cells, line: recordLine });
    cells = [];
    started = false;
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line += 1;
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      // 只有字段开头的引号才是包裹引号；字段中间的按字面量处理
      if (field.length === 0) {
        inQuotes = true;
        started = true;
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === delimiter) {
      pushField();
      started = true;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      pushRecord();
      line += 1;
      recordLine = line;
      continue;
    }

    field += ch;
    started = true;
  }

  if (started || field.length > 0 || cells.length > 0) pushRecord();
  return records;
}

/** CSV / TSV → { columns, rows }；自动识别逗号或制表符分隔 */
export function parseDelimited(text: string, delimiter?: string): ParsedUpload {
  const clean = stripBom(text);
  if (!clean.trim()) throw new KbImportError("文件是空的");

  const records = splitRecords(clean, delimiter ?? detectDelimiter(clean));
  while (records.length > 0 && records[0].cells.every((cell) => !cell.trim())) records.shift();
  const headerRecord = records.shift();
  if (!headerRecord) throw new KbImportError("没有读到表头");

  // 去掉表头末尾的空列（Excel 常见的尾随逗号）
  let headerCells = headerRecord.cells;
  let last = headerCells.length - 1;
  while (last >= 0 && !headerCells[last].trim()) last -= 1;
  if (last < 0) throw new KbImportError("第一行没有列名，请检查文件格式");
  headerCells = headerCells.slice(0, last + 1);

  const columns = buildHeader(headerCells);
  const rows: ImportRow[] = [];
  const lines: number[] = [];

  for (const record of records) {
    if (record.cells.every((cell) => !cell.trim())) continue; // 空行不占行号，也不进校验

    // 数据比表头宽：多出来的列补成「列N」，宁可多不能让数据被悄悄丢掉
    if (record.cells.length > columns.length) {
      for (let index = columns.length; index < record.cells.length; index += 1) {
        let name = `列${index + 1}`;
        while (columns.includes(name)) name = `${name}_`;
        columns.push(name);
      }
    }

    const row: ImportRow = {};
    columns.forEach((column, index) => {
      row[column] = normalizeCell(record.cells[index] ?? "");
    });
    rows.push(row);
    lines.push(record.line);
  }

  return { columns, rows, lines };
}

function jsonCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    if (value.every((item) => typeof item === "string" || typeof item === "number")) {
      return value.map(String).join("|");
    }
    return JSON.stringify(value);
  }
  return JSON.stringify(value);
}

/** JSON 对象数组 → { columns, rows }；列名取所有键的并集（按首次出现顺序） */
export function parseJsonRows(text: string): ParsedUpload {
  const clean = stripBom(text).trim();
  if (!clean) throw new KbImportError("文件是空的");

  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    throw new KbImportError("JSON 格式不合法，请检查括号与引号是否成对");
  }

  let list: unknown[];
  if (Array.isArray(parsed)) {
    list = parsed;
  } else if (parsed && typeof parsed === "object") {
    const shell = parsed as Record<string, unknown>;
    const candidate = ["rows", "data", "items", "list"]
      .map((key) => shell[key])
      .find((value) => Array.isArray(value));
    if (!candidate) throw new KbImportError("JSON 需要是对象数组，形如 [{ \"方名\": \"麻黄汤\" }]");
    list = candidate as unknown[];
  } else {
    throw new KbImportError("JSON 需要是对象数组，形如 [{ \"方名\": \"麻黄汤\" }]");
  }

  const objects = list.filter(
    (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry),
  );
  if (objects.length === 0) throw new KbImportError("JSON 里没有数据行");

  const columns: string[] = [];
  const entryColumns: string[][] = [];
  for (const entry of objects) {
    const keys: string[] = [];
    for (const key of Object.keys(entry)) {
      const name = key.trim() || `列${columns.length + 1}`;
      if (!columns.includes(name)) columns.push(name);
      keys.push(name);
    }
    entryColumns.push(keys);
  }

  const rows: ImportRow[] = [];
  const lines: number[] = [];
  objects.forEach((entry, index) => {
    const row: ImportRow = {};
    columns.forEach((column) => {
      row[column] = "";
    });
    for (const key of entryColumns[index]) {
      row[key] = jsonCell(entry[key as keyof typeof entry]);
    }
    if (columns.every((column) => !row[column])) return; // 全空对象跳过
    rows.push(row);
    lines.push(index + 1);
  });

  return { columns, rows, lines };
}

/** 文件（文件名 + 原始字节）→ 解析结果；扩展名 / 大小 / 编码都在这里把关 */
export function parseUpload(name: string, bytes: Uint8Array): ParsedUpload {
  const ext = fileExtension(name);
  if (!isImportExtension(ext)) throw new KbImportError("只支持 .csv 与 .json 文件");
  if (bytes.byteLength === 0) throw new KbImportError("文件是空的");
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new KbImportError(
      `文件超过 ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB，请拆分后分批导入`,
    );
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    throw new KbImportError("文件不是 UTF-8 编码。用 Excel 请另存为「CSV UTF-8（逗号分隔）」后再导入");
  }
  return ext === ".json" ? parseJsonRows(text) : parseDelimited(text);
}

/** 生成一行 CSV（模板下载用；带引号/逗号/换行的字段加引号转义） */
export function toCsvLine(cells: readonly string[]): string {
  return cells
    .map((cell) => {
      const text = String(cell ?? "");
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}

/** 把「30」「30g」「３０克」「1,200」这类单元格读成数字；读不出返回 null */
export function parseNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).normalize("NFKC").replace(/[,，\s]/g, "");
  const match = text.match(/^-?(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

/** 比较用的归一：全半角统一、去空白、去书名号；只用于判重，不改变入库原文 */
export function normalizeKeyText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .replace(/\s+/g, "")
    .replace(/[《》〈〉「」『』]/g, "")
    .trim();
}

/** 同名 + 同出处 = 同一个条目；键里带类型，方剂与中药同名互不干扰 */
export function kbItemKey(type: string, name: string | null | undefined, source: string | null | undefined): string {
  return `${type}\u0000${normalizeKeyText(name)}\u0000${normalizeKeyText(source)}`;
}

/** 别名按 | 、 ， ; 或换行拆开，去重，最多 20 个 */
export function splitAliases(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/[|｜、,，;；\n]+/)) {
    const alias = part.trim();
    const key = normalizeKeyText(alias);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(alias);
    if (out.length >= 20) break;
  }
  return out;
}

/** 列名 → 目标字段的同义词表（第 2 步的默认猜测用，猜错可以手改） */
const COLUMN_SYNONYMS: Record<string, ImportTargetKey> = {
  方名: "name",
  方剂名: "name",
  方剂: "name",
  名称: "name",
  药名: "name",
  中药名: "name",
  药材名: "name",
  药品名: "name",
  name: "name",
  title: "name",

  组成: "composition",
  药物组成: "composition",
  处方组成: "composition",
  方药组成: "composition",
  方药: "composition",
  药物: "composition",
  composition: "composition",
  ingredients: "composition",

  出处: "source",
  来源: "source",
  来源出处: "source",
  文献出处: "source",
  典籍: "source",
  source: "source",

  别名: "alias",
  异名: "alias",
  又名: "alias",
  aliases: "alias",
  alias: "alias",

  用法: "usageText",
  用法用量: "usageText",
  煎服法: "usageText",
  服法: "usageText",
  usage: "usageText",

  功效: "efficacy",
  功用: "efficacy",
  功能: "efficacy",
  efficacy: "efficacy",

  主治: "indication",
  适应证: "indication",
  适应症: "indication",
  主治病症: "indication",
  indication: "indication",

  禁忌: "contraindication",
  使用禁忌: "contraindication",
  禁忌症: "contraindication",
  contraindication: "contraindication",

  方解: "commentary",
  方义: "commentary",
  注释: "commentary",
  注解: "commentary",
  commentary: "commentary",

  备注: "note",
  说明: "note",
  备注信息: "note",
  note: "note",
  remark: "note",
};

/** 同义词按长度倒序，便于「药物组成」优先命中「组成」 */
const SYNONYM_ENTRIES = Object.entries(COLUMN_SYNONYMS).sort(
  (a, b) => b[0].length - a[0].length,
);

const TARGET_KEYS = new Set<string>(IMPORT_TARGETS.map((target) => target.key));

export function isImportTargetKey(value: string): value is ImportTargetKey {
  return TARGET_KEYS.has(value);
}

/** 按列名猜一份映射；猜不到的列给 "ignore" */
export function guessMapping(columns: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const column of columns) {
    const normalized = normalizeKeyText(column).toLowerCase();
    let target: ImportTargetKey | "ignore" = "ignore";
    for (const [word, key] of SYNONYM_ENTRIES) {
      if (normalized.includes(word.toLowerCase())) {
        target = key;
        break;
      }
    }
    mapping[column] = target;
  }

  // 同一目标被多列命中的，只保留第一个，避免「功效」「功用」两列都指 efficacy
  const taken = new Set<string>();
  for (const column of columns) {
    const value = mapping[column];
    if (value === "ignore") continue;
    if (taken.has(value)) mapping[column] = "ignore";
    else taken.add(value);
  }
  return mapping;
}

/** 必填字段随类型不同：方剂要方名 + 组成，中药只要有药名 */
export function requiredTargetsFor(itemType: ImportItemType): ImportTargetKey[] {
  return itemType === "herb" ? ["name"] : ["name", "composition"];
}

export function missingRequiredTargets(
  mapping: Record<string, string>,
  itemType: ImportItemType,
): ImportTargetKey[] {
  const mapped = new Set(Object.values(mapping).filter(isImportTargetKey));
  return requiredTargetsFor(itemType).filter((key) => !mapped.has(key));
}

/** 同一个目标字段被多列映射时返回这些目标字段（提示医生改掉） */
export function duplicateTargets(mapping: Record<string, string>): ImportTargetKey[] {
  const counts = new Map<string, number>();
  for (const value of Object.values(mapping)) {
    if (!isImportTargetKey(value)) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([key]) => key as ImportTargetKey);
}

const HERB_MARKERS = ["性味", "归经", "药名", "药材", "炮制", "采收", "毒性", "herb"];
const FORMULA_MARKERS = ["方名", "方剂", "组成", "方解", "formula", "composition"];

/** 从表头猜这次导入的是方剂还是中药（模板与 data/seed 的两种 CSV 都靠这个区分） */
export function inferItemType(columns: string[]): ImportItemType {
  const text = columns.map((column) => column.normalize("NFKC").toLowerCase()).join("|");
  if (FORMULA_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) return "formula";
  if (HERB_MARKERS.some((marker) => text.includes(marker.toLowerCase()))) return "herb";
  return "formula";
}

/** 映射后的一行（第 3 步展示与落库都用它） */
export type ImportDraft = {
  name: string;
  source: string;
  aliases: string[];
  composition: RxComponent[];
  usageText: string;
  efficacy: string;
  indication: string;
  contraindication: string;
  commentary: string;
  note: string;
};

export function draftFromRow(row: ImportRow, mapping: Record<string, string>): ImportDraft {
  const pick = (target: ImportTargetKey): string => {
    for (const [column, mapped] of Object.entries(mapping)) {
      if (mapped === target) return (row[column] ?? "").trim();
    }
    return "";
  };

  return {
    name: pick("name"),
    source: pick("source"),
    aliases: splitAliases(pick("alias")),
    composition: parseComposition(pick("composition")),
    usageText: pick("usageText"),
    efficacy: pick("efficacy"),
    indication: pick("indication"),
    contraindication: pick("contraindication"),
    commentary: pick("commentary"),
    note: pick("note"),
  };
}

export type ImportRowStatus = "pass" | "warn" | "error" | "update";

export type ImportValidationRow = {
  /** 原文件行号 */
  line: number;
  status: ImportRowStatus;
  /** lib/kb.ts IMPORT_CODES 里的键，按严重程度排序 */
  codes: string[];
  data: ImportDraft;
  /** 给医生看的补充说明，如 W3 的相近药名候选 */
  hints: string[];
};

export type ImportSummary = {
  total: number;
  pass: number;
  warn: number;
  error: number;
  update: number;
};

export type ImportValidateContext = {
  itemType: ImportItemType;
  /** kbItemKey → 库里已有条目（用于 E3 判重） */
  existing: Map<string, { id: string; currentVersion: number }>;
  /** 库里中药词表（药名 + herb_name 别名），已可为空：空数组表示跳过 W3 */
  herbTerms: string[];
};

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current;
  }
  return previous[b.length];
}

/** 编辑距离最近的 3 个候选，帮医生认出「黄芹 → 黄芩」这类错字 */
function nearestHerbs(name: string, terms: string[], limit = 3): string[] {
  const target = normalizeKeyText(name);
  if (!target) return [];
  const scored: { term: string; distance: number }[] = [];
  for (const term of terms) {
    if (!term || term === target) continue;
    const distance = editDistance(target, term);
    if (distance <= Math.max(1, Math.floor(target.length / 2))) {
      scored.push({ term, distance });
    }
  }
  scored.sort((a, b) => a.distance - b.distance || a.term.length - b.term.length);
  return scored.slice(0, limit).map((entry) => entry.term);
}

function isKnownHerb(name: string, terms: string[], exact: Set<string>): boolean {
  const target = normalizeKeyText(name);
  if (!target) return false;
  if (exact.has(target)) return true;
  // 「药名包含于词表条目」也认（如「炙甘草」算已知的「甘草」）
  return terms.some((term) => term.includes(target));
}

/**
 * 逐行校验。错误行（E1/E2）入库时一律跳过；
 * E3 不是错误，只是「库里有同名同出处的条目」→ 状态 update（导入时新增版本）。
 */
export function validateImportRows(
  rows: ImportRow[],
  lines: number[],
  mapping: Record<string, string>,
  context: ImportValidateContext,
): ImportValidationRow[] {
  const herbTerms = Array.from(
    new Set(context.herbTerms.map((term) => normalizeKeyText(term)).filter(Boolean)),
  );
  const herbTermSet = new Set(herbTerms);
  const isHerbImport = context.itemType === "herb";

  return rows.map((row, index) => {
    const data = draftFromRow(row, mapping);
    const codes: string[] = [];
    const hints: string[] = [];

    if (!data.name) codes.push("E1");
    if (!isHerbImport && data.composition.length === 0) codes.push("E2");

    const isUpdate =
      Boolean(data.name) && context.existing.has(kbItemKey(context.itemType, data.name, data.source));
    if (isUpdate) codes.push("E3");

    if (!data.source) codes.push("W1");
    if (!isHerbImport && data.composition.some((part) => !part.dose)) codes.push("W2");

    if (!isHerbImport && herbTermSet.size > 0 && data.composition.length > 0) {
      const unknown = data.composition
        .map((part) => part.name)
        .filter((name) => !isKnownHerb(name, herbTerms, herbTermSet));
      if (unknown.length > 0) {
        codes.push("W3");
        for (const name of unknown.slice(0, 2)) {
          const candidates = nearestHerbs(name, herbTerms);
          hints.push(
            candidates.length > 0
              ? `「${name}」不在中药词表，相近的有：${candidates.join("、")}`
              : `「${name}」不在中药词表`,
          );
        }
        if (unknown.length > 2) hints.push(`另有 ${unknown.length - 2} 味药不在词表`);
      }
    }

    let status: ImportRowStatus;
    if (codes.includes("E1") || codes.includes("E2")) status = "error";
    else if (isUpdate) status = "update";
    else if (codes.length > 0) status = "warn";
    else status = "pass";

    return { line: lines[index] ?? index + 1, status, codes, data, hints };
  });
}

export function summarizeRows(rows: ImportValidationRow[]): ImportSummary {
  const summary: ImportSummary = {
    total: rows.length,
    pass: 0,
    warn: 0,
    error: 0,
    update: 0,
  };
  for (const row of rows) {
    summary[row.status] += 1;
  }
  return summary;
}

/** 本次会真正写库的行：update 不算警告，两种模式都写；warn 只在 mode=all 时写 */
export function selectRowsForCommit(
  rows: ImportValidationRow[],
  mode: "pass" | "all",
): ImportValidationRow[] {
  return rows.filter(
    (row) =>
      row.status === "pass" ||
      row.status === "update" ||
      (mode === "all" && row.status === "warn"),
  );
}
