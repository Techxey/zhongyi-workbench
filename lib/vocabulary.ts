// 接诊词库的共享类型与小工具（客户端/服务端都能 import）。
// 词条存在数据库 consult_terms 表里，医生可增删，全站共享。

export type VocabCategory = "tongue" | "pulse" | "syndrome" | "treatment";

export type VocabItem = {
  id: string;
  category: VocabCategory;
  term: string;
  hint: string | null;
  useCount: number;
  builtin: boolean;
};

export type SyndromeAlias = { term: string; normTerm: string };

export const VOCAB_CATEGORIES: VocabCategory[] = ["tongue", "pulse", "syndrome", "treatment"];

export const VOCAB_LABELS: Record<VocabCategory, string> = {
  tongue: "舌象",
  pulse: "脉象",
  syndrome: "证型",
  treatment: "治法",
};

export const VOCAB_HINTS: Record<VocabCategory, string> = {
  tongue: "如「舌淡红」「苔薄白」，可增删，全站共享",
  pulse: "如「脉细」「脉弦」，可增删，全站共享",
  syndrome: "证型会按主诉/现病史里的关键词自动排前",
  treatment: "常用治法点一下就填，也可直接手写",
};

/** 每个分类默认展示的条数（按使用频次排序后的前 N 条） */
export const VOCAB_VISIBLE = 12;

export function groupVocab(items: VocabItem[]): Record<VocabCategory, VocabItem[]> {
  const grouped: Record<VocabCategory, VocabItem[]> = {
    tongue: [],
    pulse: [],
    syndrome: [],
    treatment: [],
  };
  for (const item of items) {
    (grouped[item.category] ??= []).push(item);
  }
  for (const key of VOCAB_CATEGORIES) {
    grouped[key].sort((a, b) => b.useCount - a.useCount || a.term.localeCompare(b.term, "zh"));
  }
  return grouped;
}

export type SyndromeCandidate = VocabItem & { score: number };

/**
 * 证型候选：用知识库别名（失眠→心脾两虚）和证型名本身去命中主诉/现病史/问诊要点。
 * 命中才进候选；没命中时返回使用频次最高的几个，保证医生仍有快捷可选。
 */
export function pickSyndromeCandidates(
  text: string,
  syndromes: VocabItem[],
  aliases: SyndromeAlias[],
  limit = 6,
): SyndromeCandidate[] {
  const haystack = text.replace(/\s+/g, "");
  const scores = new Map<string, number>();

  for (const alias of aliases) {
    if (!alias.term) continue;
    if (haystack.includes(alias.term.replace(/\s+/g, ""))) {
      scores.set(alias.normTerm, (scores.get(alias.normTerm) ?? 0) + 2);
    }
  }
  for (const item of syndromes) {
    if (item.term && haystack.includes(item.term)) {
      scores.set(item.term, (scores.get(item.term) ?? 0) + 3);
    }
  }

  const hits = syndromes
    .map((item) => ({ ...item, score: scores.get(item.term) ?? 0 }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || b.useCount - a.useCount)
    .slice(0, limit);

  if (hits.length > 0) return hits;
  return syndromes.slice(0, limit).map((item) => ({ ...item, score: 0 }));
}

/** 舌象/脉象展示：按频次取前 N 条，已选中的即使排后面也要显示 */
export function visibleTerms(items: VocabItem[], selected: string[], limit = VOCAB_VISIBLE): VocabItem[] {
  const head = items.slice(0, limit);
  const headTerms = new Set(head.map((item) => item.term));
  const extras = items.filter((item) => selected.includes(item.term) && !headTerms.has(item.term));
  return [...head, ...extras];
}
