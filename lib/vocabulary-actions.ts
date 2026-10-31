"use server";

// 接诊词库的读写动作：接诊台与「设置 · 词库管理」共用。
// 所有改动全站生效（存在 consult_terms 表，不按患者区分）。

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import type { VocabCategory, VocabItem } from "@/lib/vocabulary";
export type VocabActionResult =
  | { ok: true; item: VocabItem }
  | { ok: false; message: string };

function rowToItem(row: {
  id: string;
  category: string;
  term: string;
  hint: string | null;
  useCount: number;
  builtin: number;
}): VocabItem {
  return {
    id: row.id,
    category: row.category as VocabCategory,
    term: row.term,
    hint: row.hint,
    useCount: row.useCount,
    builtin: row.builtin === 1,
  };
}

function normalizeCategory(value: string): VocabCategory | null {
  return value === "tongue" || value === "pulse" || value === "syndrome" || value === "treatment"
    ? value
    : null;
}

/** 新增（或复用已存在的）词条。证型可带默认治法 hint。 */
export async function addConsultTerm(input: {
  category: string;
  term: string;
  hint?: string;
}): Promise<VocabActionResult> {
  const user = await requireUser();
  const category = normalizeCategory(input.category);
  if (!category) return { ok: false, message: "词条分类不正确" };

  const term = input.term.trim().replace(/\s+/g, "");
  if (!term) return { ok: false, message: "请填词条内容" };
  if (term.length > 20) return { ok: false, message: "词条太长，请控制在 20 字以内" };

  const hint = category === "syndrome" ? (input.hint?.trim() || null) : null;

  const existing = await prisma.consultTerm.findUnique({
    where: { category_term: { category, term } },
  });

  if (existing) {
    const row = await prisma.consultTerm.update({
      where: { id: existing.id },
      data: { hint: hint ?? existing.hint, useCount: existing.useCount + 1 },
    });
    await prisma.auditLog.create({
      data: {
        entityType: "consult_term",
        entityId: row.id,
        action: "update",
        beforeJson: JSON.stringify({ term: existing.term, hint: existing.hint }),
        afterJson: JSON.stringify({ term: row.term, hint: row.hint }),
        operatorId: user.id,
        createdAt: new Date().toISOString(),
      },
    });
    revalidatePath("/visits", "layout");
    revalidatePath("/settings/vocabulary");
    return { ok: true, item: rowToItem(row) };
  }

  const maxSort = await prisma.consultTerm.aggregate({
    where: { category },
    _max: { sortNo: true },
  });

  const row = await prisma.consultTerm.create({
    data: {
      category,
      term,
      hint,
      useCount: 1,
      sortNo: (maxSort._max.sortNo ?? 0) + 1,
      builtin: 0,
      createdAt: new Date().toISOString(),
    },
  });

  await prisma.auditLog.create({
    data: {
      entityType: "consult_term",
      entityId: row.id,
      action: "create",
      beforeJson: null,
      afterJson: JSON.stringify({ category, term, hint }),
      operatorId: user.id,
      createdAt: new Date().toISOString(),
    },
  });

  revalidatePath("/visits", "layout");
  revalidatePath("/settings/vocabulary");
  return { ok: true, item: rowToItem(row) };
}

/** 删除词条（全站生效）。内置词条也允许删，删空了可以随时再加。 */
export async function deleteConsultTerm(id: string): Promise<{ ok: boolean; message?: string }> {
  const user = await requireUser();
  const row = await prisma.consultTerm.findUnique({ where: { id } });
  if (!row) return { ok: false, message: "词条已经不存在" };

  await prisma.consultTerm.delete({ where: { id } });
  await prisma.auditLog.create({
    data: {
      entityType: "consult_term",
      entityId: id,
      action: "delete",
      beforeJson: JSON.stringify({ category: row.category, term: row.term }),
      afterJson: null,
      operatorId: user.id,
      createdAt: new Date().toISOString(),
    },
  });

  revalidatePath("/visits", "layout");
  revalidatePath("/settings/vocabulary");
  return { ok: true };
}

/** 选中即累加使用频次，让常用词自然排到前面 */
export async function bumpConsultTerms(category: string, terms: string[]): Promise<void> {
  await requireUser();
  const normalized = normalizeCategory(category);
  if (!normalized || terms.length === 0) return;
  await prisma.consultTerm.updateMany({
    where: { category: normalized, term: { in: terms } },
    data: { useCount: { increment: 1 } },
  });
  revalidatePath("/visits", "layout");
}
