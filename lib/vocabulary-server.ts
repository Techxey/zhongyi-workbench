// 词库的只读加载（服务端用）
import { prisma } from "@/lib/db";
import type { VocabCategory, VocabItem } from "@/lib/vocabulary";

export async function loadVocabItems(): Promise<VocabItem[]> {
  const rows = await prisma.consultTerm.findMany({
    orderBy: [{ category: "asc" }, { useCount: "desc" }, { sortNo: "asc" }],
  });
  return rows.map((row) => ({
    id: row.id,
    category: row.category as VocabCategory,
    term: row.term,
    hint: row.hint,
    useCount: row.useCount,
    builtin: row.builtin === 1,
  }));
}
