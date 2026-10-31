/**
 * 接诊台共享逻辑：客户端与服务端都要用，所以不能 import 任何 node/next 依赖。
 * 这里只放纯函数与类型，保证同一套校验/差异计算在两边结果一致。
 */

export type HerbDraft = {
  /** 客户端行 key，服务端忽略 */
  key: string;
  name: string;
  doseValue: string;
  doseUnit: string;
  role: string | null;
};

export type PrescriptionDraft = {
  formulaName: string;
  formulaSource: string;
  kbItemId: string | null;
  kbItemVersion: number | null;
  doses: string;
  usageText: string;
  items: HerbDraft[];
};

export type VisitDraft = {
  chiefComplaint: string;
  presentIllness: string;
  symptoms: string[];
  tongue: string[];
  pulse: string[];
  syndrome: string;
  treatment: string;
  advice: string;
  followupDays: string;
  remindFollowup: boolean;
  amendedReason: string;
  prescription: PrescriptionDraft;
};

export type ValidationError = { field: string; message: string };

export const DEFAULT_USAGE = "每日 1 剂，水煎 400ml，分早晚温服";

/** 空白处方一开始给 10 行空药味，像纸质处方笺一样直接往下写，省掉反复点「加一味」 */
const BLANK_HERB_ROWS = 10;

export function emptyDraft(): VisitDraft {
  return {
    chiefComplaint: "",
    presentIllness: "",
    symptoms: [],
    tongue: [],
    pulse: [],
    syndrome: "",
    treatment: "",
    advice: "",
    followupDays: "7",
    remindFollowup: true,
    amendedReason: "",
    prescription: {
      formulaName: "",
      formulaSource: "",
      kbItemId: null,
      kbItemVersion: null,
      doses: "7",
      usageText: DEFAULT_USAGE,
      items: Array.from({ length: BLANK_HERB_ROWS }, (_, index) => ({
        key: `blank-${index}`,
        name: "",
        doseValue: "",
        doseUnit: "g",
        role: null,
      })),
    },
  };
}

export function newHerb(name = "", doseValue = "", doseUnit = "g"): HerbDraft {
  return {
    key: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name,
    doseValue,
    doseUnit,
    role: null,
  };
}

/** 药味行是空的（没填药名）就当作不存在 */
export function herbLines(items: HerbDraft[]): { name: string; dose: string }[] {
  return items
    .filter((item) => item.name.trim().length > 0)
    .map((item) => ({ name: item.name.trim(), dose: formatDose(item.doseValue, item.doseUnit) }));
}

export function formatDose(value: string, unit: string): string {
  const v = value.trim();
  if (!v) return unit === "g" ? "" : `${v}${unit}`;
  const u = unit.trim();
  return u === "g" ? `${v}g` : `${v}${u}`;
}

/** "15g" / "3片" → { value: "15", unit: "g" } */
export function parseDose(dose: string | null | undefined): { value: string; unit: string } {
  if (!dose) return { value: "", unit: "g" };
  const match = dose.trim().match(/^([\d.]+)\s*(.*)$/);
  if (!match) return { value: "", unit: dose.trim() };
  return { value: match[1], unit: match[2] || "g" };
}

export function isNumericDose(value: string): boolean {
  if (!value.trim()) return false;
  return /^\d+(\.\d+)?$/.test(value.trim()) && Number(value) > 0;
}

/** 保存前校验：缺什么就直接说缺什么，不弹窗 */
export function validateDraft(draft: VisitDraft, isAmend: boolean): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!draft.chiefComplaint.trim()) {
    errors.push({ field: "chiefComplaint", message: "缺主诉" });
  }
  if (!draft.syndrome.trim()) {
    errors.push({ field: "syndrome", message: "缺证型" });
  }

  const items = draft.prescription.items.filter((item) => item.name.trim());
  if (items.length === 0) {
    errors.push({ field: "items", message: "缺药味（至少 1 味）" });
  }
  const badDose = items.find((item) => !isNumericDose(item.doseValue));
  if (badDose) {
    errors.push({
      field: "items",
      message: `「${badDose.name}」的剂量不是有效数字`,
    });
  }

  if (draft.followupDays.trim() && !/^\d+$/.test(draft.followupDays.trim())) {
    errors.push({ field: "followupDays", message: "复诊天数只能填数字" });
  }
  if (draft.prescription.doses.trim() && !/^\d+$/.test(draft.prescription.doses.trim())) {
    errors.push({ field: "doses", message: "剂数只能填数字" });
  }
  if (isAmend && !draft.amendedReason.trim()) {
    errors.push({ field: "amendedReason", message: "修订已提交病历必须填写修订原因" });
  }

  return errors;
}

export type RxLine = { name: string; dose: string };

export type RxDiff = {
  added: RxLine[];
  removed: RxLine[];
  changed: { name: string; from: string; to: string }[];
  empty: boolean;
};

/** 与上一次处方比较：加 X、减 Y、改 Z 剂量 */
export function diffPrescription(prev: RxLine[] | null | undefined, next: RxLine[]): RxDiff {
  const before = new Map((prev ?? []).map((line) => [line.name, line.dose]));
  const after = new Map(next.map((line) => [line.name, line.dose]));

  const added = next.filter((line) => !before.has(line.name));
  const removed = (prev ?? []).filter((line) => !after.has(line.name));
  const changed: { name: string; from: string; to: string }[] = [];
  for (const line of next) {
    const from = before.get(line.name);
    if (from !== undefined && from !== line.dose) {
      changed.push({ name: line.name, from, to: line.dose });
    }
  }

  return {
    added,
    removed,
    changed,
    empty: added.length === 0 && removed.length === 0 && changed.length === 0,
  };
}

export type IncompatPair = { herbA: string; herbB: string; rule: string };

/** 十八反 / 十九畏：命中就提示，不阻止保存 */
export function findIncompatibilities(
  herbNames: string[],
  pairs: IncompatPair[],
): IncompatPair[] {
  const names = new Set(herbNames.map((name) => name.trim()));
  const hits: IncompatPair[] = [];
  for (const pair of pairs) {
    if (names.has(pair.herbA) && names.has(pair.herbB)) hits.push(pair);
  }
  return hits;
}

export type SyndromeAlias = { label: string; term: string; normTerm: string; weight: number };

/**
 * 证型候选取自知识库别名：先看主诉/现病史/问诊要点里命中了哪些别名，
 * 命中多的排前面；一个都没命中时，退回按权重给常用证型（避免空列表）。
 */
export function pickSyndromeCandidates(
  text: string,
  aliases: SyndromeAlias[],
  limit = 6,
): string[] {
  const haystack = text.replace(/\s+/g, "");
  const score = new Map<string, number>();

  for (const alias of aliases) {
    const term = (alias.term || alias.label).replace(/\s+/g, "");
    if (!term) continue;
    const weight = alias.weight || 1;
    const label = alias.normTerm || alias.label;
    const current = score.get(label) ?? 0;
    if (haystack.includes(term) || haystack.includes(label)) {
      score.set(label, current + weight + term.length);
    } else if (!score.has(label)) {
      score.set(label, 0);
    }
  }

  const entries = [...score.entries()];
  const hits = entries.filter(([, value]) => value > 0);
  const pool = hits.length > 0 ? hits : entries;
  return pool
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label]) => label);
}

/** 舌象 / 脉象的常用取值（第一版用固定词表，避免自造数据） */
export const TONGUE_OPTIONS = [
  "舌淡红",
  "舌淡白",
  "舌红",
  "舌绛",
  "舌紫暗",
  "舌胖大",
  "舌边齿痕",
  "苔薄白",
  "苔白腻",
  "苔黄腻",
  "苔少",
  "苔剥落",
];

export const PULSE_OPTIONS = [
  "脉浮",
  "脉沉",
  "脉迟",
  "脉数",
  "脉弦",
  "脉滑",
  "脉细",
  "脉濡",
  "脉涩",
  "脉虚",
  "脉紧",
  "脉结代",
];

/** 常见证型 → 治法建议（用户第一版只做「提示」，最终由医生自己改） */
export const TREATMENT_HINTS: Record<string, string> = {
  心脾两虚: "益气补血，健脾养心",
  气血两虚: "益气补血",
  肝郁气滞: "疏肝解郁，理气和中",
  肝郁脾虚: "疏肝健脾",
  脾胃虚弱: "健脾益气，和胃渗湿",
  脾肾阳虚: "温补脾肾",
  肾阴虚: "滋补肾阴",
  肾阳虚: "温补肾阳",
  痰湿内阻: "燥湿化痰，理气和中",
  湿热蕴结: "清热利湿",
  风寒表证: "辛温解表",
  风热表证: "辛凉解表",
  血瘀证: "活血化瘀",
  阴虚火旺: "滋阴降火",
  心肾不交: "滋阴降火，交通心肾",
};
