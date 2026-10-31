/**
 * 知识库共享层：方剂/中药/医案/古籍的类型、组成解析、导入字段约定。
 * 纯函数，不引用 next/* 与 prisma，客户端与服务端都能 import。
 */

export type KbItemType = "formula" | "herb" | "case" | "classic";

export const KB_TABS: { type: KbItemType; label: string; unit: string }[] = [
  { type: "formula", label: "方剂", unit: "首" },
  { type: "herb", label: "中药", unit: "味" },
  { type: "case", label: "医案", unit: "则" },
  { type: "classic", label: "古籍", unit: "条" },
];

export const KB_TYPE_LABEL: Record<KbItemType, string> = {
  formula: "方剂",
  herb: "中药",
  case: "医案",
  classic: "古籍",
};

export type RxComponent = { name: string; dose: string };

/** 把「黄芪30g|党参15g」「黄芪30g、党参 15」「黄芪 30 党参 15」或 JSON 数组解析成药味列表 */
export function parseComposition(raw: string | null | undefined): RxComponent[] {
  if (!raw) return [];
  const text = raw.trim();
  if (!text) return [];

  // JSON 数组：[{name,dose}] 或 ["黄芪30g"]
  if (text.startsWith("[")) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => {
            if (typeof entry === "string") return splitHerb(entry);
            if (entry && typeof entry === "object") {
              const name = String((entry as { name?: unknown }).name ?? "").trim();
              const dose = String((entry as { dose?: unknown }).dose ?? "").trim();
              return name ? { name, dose } : null;
            }
            return null;
          })
          .filter((entry): entry is RxComponent => Boolean(entry));
      }
    } catch {
      // 落到下面的文本解析
    }
  }

  // 统一分隔符：| 、 ， ; 换行。顿号/逗号在剂量里不会出现
  return text
    .split(/[|、,，;；\n]+/)
    .map((chunk) => splitHerb(chunk))
    .filter((entry): entry is RxComponent => Boolean(entry));
}

const DOSE_RE = /^([\d.]+(?:\s*[-~]\s*[\d.]+)?\s*(?:g|G|克|g克|mg|毫升|ml|片|枚|粒|个|条|包|支|袋|钱|两|寸|适量|少许|若干))\s*(.*)$/;

/** 单味：「黄芪30g」「黄芪 30 g」「甘草（炙）6g」 */
export function splitHerb(chunk: string): RxComponent | null {
  const text = chunk.replace(/[。\s]+$/g, "").trim();
  if (!text) return null;

  const direct = text.match(/^(.+?)\s*([\d.]+\s*(?:g|G|克|mg|毫升|ml|片|枚|粒|个|条|包|支|袋|钱|两))\s*(.*)$/);
  if (direct) {
    const name = cleanName(direct[1]);
    const dose = `${direct[2].replace(/\s+/g, "")}${direct[3] ? "" : ""}`.trim();
    return name ? { name, dose } : null;
  }

  // 「黄芪 30」（无单位，按 g 理解）；「黄芪适量」
  const loose = text.match(/^(.+?)\s+(\d+(?:\.\d+)?)\s*$/) ?? text.match(/^(.+?)(?:适量|少许|若干)$/);
  if (loose) {
    const name = cleanName(loose[1]);
    const dose = /^\d/.test(loose[2] ?? "") ? `${loose[2]}g` : (loose[2] ?? "适量");
    return name ? { name, dose } : null;
  }

  const onlyName = cleanName(text);
  return onlyName ? { name: onlyName, dose: "" } : null;
}

function cleanName(raw: string): string {
  return raw.replace(/^[\s:：、,，\-·]+|[\s:：,，]+$/g, "").trim();
}

export function formatCompositionJson(parts: RxComponent[]): string {
  return JSON.stringify(parts.map((part) => ({ name: part.name, dose: part.dose })));
}

export function compositionText(parts: RxComponent[]): string {
  return parts.map((part) => `${part.name}${part.dose}`).join("|");
}

/** 导入向导：可映射的目标字段 */
export const IMPORT_TARGETS = [
  { key: "name", label: "方名 / 药名", required: true },
  { key: "composition", label: "组成", required: true },
  { key: "source", label: "出处", required: false },
  { key: "alias", label: "别名（| 分隔）", required: false },
  { key: "usageText", label: "用法", required: false },
  { key: "efficacy", label: "功效", required: false },
  { key: "indication", label: "主治", required: false },
  { key: "contraindication", label: "禁忌", required: false },
  { key: "commentary", label: "方解", required: false },
  { key: "note", label: "备注", required: false },
] as const;

export type ImportTargetKey = (typeof IMPORT_TARGETS)[number]["key"];

/** 模板列头（附录 B） */
export const IMPORT_TEMPLATE_HEAD = [
  "方名",
  "别名",
  "出处",
  "组成",
  "功效",
  "主治",
  "用法",
  "禁忌",
  "方解",
  "备注",
];

export const IMPORT_TEMPLATE_SAMPLE = [
  "归脾汤",
  "归脾丸|人参归脾汤",
  "《正体类要》",
  "黄芪30g|党参15g|炒白术15g|当归12g|茯神15g|远志6g|炒酸枣仁20g|木香6g|炙甘草6g",
  "益气补血、健脾养心",
  "心脾两虚证。心悸怔忡、失眠多梦、食少体倦、面色萎黄",
  "水煎服，每日1剂，分早晚温服",
  "阴虚火旺者慎用",
  "治思虑过度，劳伤心脾，气血亏虚",
  "示例行，导入前可删除",
];

/** 校验码 → 说明（界面与文档同文案） */
export const IMPORT_CODES: Record<string, { level: "error" | "warn"; text: string }> = {
  E1: { level: "error", text: "方名为空" },
  E2: { level: "error", text: "组成解析后为 0 味" },
  E3: { level: "error", text: "重名且同出处（默认视为同一方的更新）" },
  W1: { level: "warn", text: "缺少出处" },
  W2: { level: "warn", text: "某味药没有剂量" },
  W3: { level: "warn", text: "药名不在中药词表里，可能是错别字" },
};
