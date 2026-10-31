import { prisma } from "@/lib/db";
import { pinyinOf } from "@/lib/format";
import { parseComposition, type KbItemType } from "@/lib/kb";

/**
 * 知识库检索：内存倒排 + 别名归一 + 可解释排序。
 * 数据量 < 5000 条，直接全量进内存，不引搜索引擎。
 * 排序（与规格一致，全部可解释）：
 *   1) 与本次病历已选症状/证型的重合数（desc）
 *   2) 医生历史使用次数（desc）
 *   3) 条目完整度：有出处、有组成、有用法 各 1 分
 * 先按「查询命中强度」分档（名称 > 别名 > 拼音 > 组成药味 > 主治/功效），同档再比上面三条。
 */

export type KbSearchDoc = {
  id: string;
  type: KbItemType;
  name: string;
  source: string | null;
  aliases: string[];
  herbNames: string[];
  components: { name: string; dose: string }[];
  herbCount: number;
  efficacy: string;
  indication: string;
  usageText: string;
  version: number;
  usageCount: number;
  completeness: number;
};

export type KbIntent = {
  kind: "symptom" | "syndrome" | "formula" | "herb";
  text: string;
  norm: string;
};

export type KbSearchHit = KbSearchDoc & {
  score: number;
  overlap: number;
  reason: string;
};

export type KbTabResult = {
  hits: KbSearchHit[];
  matched: number;
};

export type KbSearchResponse = {
  query: string;
  intents: KbIntent[];
  tabs: Record<KbItemType, KbTabResult>;
  index: { formulas: number; herbs: number; cases: number; classics: number; loadedAt: string };
};

type Index = {
  docs: KbSearchDoc[];
  aliases: { term: string; norm: string; kind: KbIntent["kind"] }[];
  loadedAt: number;
};

const CACHE_TTL_MS = 20_000;

// 用 globalThis 存缓存：dev 下 route handler 与 server action 可能是两份独立的模块实例，
// 模块级变量各自失效，只有同一个进程的 globalThis 才能让「导入后立刻能搜到」成立。
type IndexCache = { value: Index | null };
const cacheRef: IndexCache =
  ((globalThis as { __zybKbIndexCache?: IndexCache }).__zybKbIndexCache ??= { value: null });

export async function loadKbIndex(force = false): Promise<Index> {
  const cache = cacheRef.value;
  if (!force && cache && Date.now() - cache.loadedAt < CACHE_TTL_MS) return cache;

  const [items, usage] = await Promise.all([
    prisma.kbItem.findMany({
      include: {
        versions: { orderBy: { version: "desc" }, take: 1 },
        aliases: true,
      },
    }),
    prisma.prescription.groupBy({
      by: ["kbItemId"],
      _count: { _all: true },
      where: { kbItemId: { not: null } },
    }),
  ]);

  const usageMap = new Map<string, number>();
  for (const row of usage) {
    if (row.kbItemId) usageMap.set(row.kbItemId, row._count._all);
  }

  const docs: KbSearchDoc[] = items
    .filter((item) => item.status !== "disabled")
    .map((item) => {
      const version = item.versions[0];
      const parts = parseComposition(version?.compositionJson ?? null);
      const completeness =
        (item.source ? 1 : 0) + (parts.length > 0 ? 1 : 0) + (version?.usageText ? 1 : 0);
      return {
        id: item.id,
        type: (item.type as KbItemType) ?? "formula",
        name: item.name,
        source: item.source,
        aliases: item.aliases.filter((alias) => alias.aliasType !== "syndrome").map((alias) => alias.term),
        herbNames: parts.map((part) => part.name),
        components: parts,
        herbCount: parts.length,
        efficacy: version?.efficacy ?? "",
        indication: version?.indication ?? "",
        usageText: version?.usageText ?? "",
        version: version?.version ?? 1,
        usageCount: usageMap.get(item.id) ?? 0,
        completeness,
      };
    });

  const aliasRows = await prisma.kbAlias.findMany({
    where: { aliasType: { in: ["symptom", "syndrome", "formula_name", "herb_name"] } },
    select: { term: true, normTerm: true, aliasType: true },
  });

  const aliases = aliasRows
    .filter((row) => row.term && row.term.length >= 2)
    .map((row) => ({
      term: row.term,
      norm: row.normTerm || row.term,
      kind:
        row.aliasType === "symptom"
          ? ("symptom" as const)
          : row.aliasType === "syndrome"
            ? ("syndrome" as const)
            : row.aliasType === "formula_name"
              ? ("formula" as const)
              : ("herb" as const),
    }))
    .sort((a, b) => b.term.length - a.term.length);

  const next: Index = { docs, aliases, loadedAt: Date.now() };
  cacheRef.value = next;
  return next;
}

export function invalidateKbIndex() {
  cacheRef.value = null;
}

const INTENT_ORDER: KbIntent["kind"][] = ["symptom", "syndrome", "formula", "herb"];

/** 用别名表做最长匹配，把自由输入拆成结构化标签（不调用任何模型） */
export function parseIntents(query: string, aliases: Index["aliases"]): KbIntent[] {
  const text = query.trim();
  if (!text) return [];

  const lower = text.toLowerCase();
  const taken: [number, number][] = [];
  const intents: KbIntent[] = [];

  for (const alias of aliases) {
    const needle = alias.term.toLowerCase();
    if (needle.length < 2) continue;
    let from = 0;
    while (from <= lower.length - needle.length) {
      const at = lower.indexOf(needle, from);
      if (at === -1) break;
      const end = at + needle.length;
      const overlaps = taken.some(([start, stop]) => at < stop && end > start);
      if (!overlaps) {
        taken.push([at, end]);
        intents.push({ kind: alias.kind, text: text.slice(at, end), norm: alias.norm });
      }
      from = at + needle.length;
    }
  }

  // 按出现位置排序、同类去重
  intents.sort((a, b) => text.indexOf(a.text) - text.indexOf(b.text));
  const seen = new Set<string>();
  return intents
    .filter((intent) => {
      const key = `${intent.kind}:${intent.norm}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => INTENT_ORDER.indexOf(a.kind) - INTENT_ORDER.indexOf(b.kind));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[\s，,。；;、·（）()《》「」]/g, "");
}

function haystack(doc: KbSearchDoc): string {
  return normalize([doc.name, doc.source ?? "", doc.efficacy, doc.indication, ...doc.aliases].join(" "));
}

/** 查询命中强度分档：数字越大越靠前；0 表示不匹配 */
function matchTier(doc: KbSearchDoc, query: string): { tier: number; reason: string } {
  const q = query.trim();
  if (!q) return { tier: 1, reason: "常用" };

  const nq = normalize(q);
  if (!nq) return { tier: 1, reason: "常用" };

  const name = normalize(doc.name);
  if (name === nq) return { tier: 100, reason: "名称一致" };
  if (name.startsWith(nq)) return { tier: 90, reason: "名称前缀" };
  if (name.includes(nq)) return { tier: 80, reason: "名称包含" };

  if (doc.aliases.some((alias) => normalize(alias).includes(nq))) return { tier: 70, reason: "别名命中" };

  const py = pinyinOf(doc.name);
  if (py.full.startsWith(nq) || py.initials === nq) return { tier: 60, reason: "拼音命中" };

  if (doc.herbNames.some((herb) => normalize(herb).includes(nq))) return { tier: 45, reason: "组成含此药" };

  const label = haystack(doc);
  if (label.includes(nq)) return { tier: 30, reason: "主治/功效命中" };

  return { tier: 0, reason: "" };
}

function overlapOf(doc: KbSearchDoc, terms: string[]): number {
  if (terms.length === 0) return 0;
  const label = haystack(doc);
  let hits = 0;
  for (const term of terms) {
    const norm = normalize(term);
    if (norm.length >= 2 && label.includes(norm)) hits += 1;
  }
  return hits;
}

export type KbSearchContext = {
  symptoms?: string[];
  syndrome?: string | null;
};

export async function searchKb(query: string, context: KbSearchContext = {}): Promise<KbSearchResponse> {
  const index = await loadKbIndex();
  const intents = parseIntents(query, index.aliases);

  const contextTerms = [
    ...(context.symptoms ?? []),
    ...(context.syndrome ? [context.syndrome] : []),
  ].filter(Boolean);

  const tabs: Record<KbItemType, KbTabResult> = {
    formula: { hits: [], matched: 0 },
    herb: { hits: [], matched: 0 },
    case: { hits: [], matched: 0 },
    classic: { hits: [], matched: 0 },
  };

  for (const doc of index.docs) {
    const { tier, reason } = matchTier(doc, query);
    if (tier === 0) continue;

    const overlap = overlapOf(doc, contextTerms);
    const score = tier * 1000 + overlap * 60 + Math.min(doc.usageCount, 20) * 2 + doc.completeness;

    tabs[doc.type].matched += 1;
    tabs[doc.type].hits.push({ ...doc, score, overlap, reason });
  }

  const counts = {
    formulas: index.docs.filter((doc) => doc.type === "formula").length,
    herbs: index.docs.filter((doc) => doc.type === "herb").length,
    cases: index.docs.filter((doc) => doc.type === "case").length,
    classics: index.docs.filter((doc) => doc.type === "classic").length,
  };

  for (const key of Object.keys(tabs) as KbItemType[]) {
    tabs[key].hits.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.usageCount !== a.usageCount) return b.usageCount - a.usageCount;
      return a.name.localeCompare(b.name, "zh");
    });
    tabs[key].hits = tabs[key].hits.slice(0, 20);
  }

  return {
    query,
    intents,
    tabs,
    index: { ...counts, loadedAt: new Date(index.loadedAt).toISOString() },
  };
}
