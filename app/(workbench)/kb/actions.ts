"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { parseComposition, formatCompositionJson } from "@/lib/kb";

export type KbActionState = { ok: boolean; message: string };

/** 停用 / 启用：知识库条目只停用不删除 */
export async function toggleKbItem(id: string): Promise<KbActionState> {
  const user = await requireUser();
  const item = await prisma.kbItem.findUnique({ where: { id } });
  if (!item) return { ok: false, message: "条目不存在" };

  const next = item.status === "disabled" ? "active" : "disabled";
  await prisma.kbItem.update({
    where: { id },
    data: { status: next, updatedAt: new Date().toISOString() },
  });
  await writeAudit({
    entityType: "kb_item",
    entityId: id,
    action: "update",
    before: { status: item.status },
    after: { status: next },
    operatorId: user.id,
  });
  revalidatePath("/kb");
  revalidatePath("/visits", "layout");
  return { ok: true, message: next === "disabled" ? "已停用，检索里不再出现" : "已重新启用" };
}

/** 编辑即新增版本：旧版本保留，可回看 */
export async function saveKbVersion(formData: FormData): Promise<KbActionState> {
  const user = await requireUser();
  const id = String(formData.get("id") ?? "");
  if (!id) return { ok: false, message: "缺少条目" };

  const item = await prisma.kbItem.findUnique({
    where: { id },
    include: { versions: { orderBy: { version: "desc" }, take: 1 } },
  });
  if (!item) return { ok: false, message: "条目不存在" };

  const name = String(formData.get("name") ?? "").trim();
  const source = String(formData.get("source") ?? "").trim();
  const composition = parseComposition(String(formData.get("composition") ?? ""));
  if (!name) return { ok: false, message: "名称不能为空" };
  if (item.type === "formula" && composition.length === 0) {
    return { ok: false, message: "方剂组成不能为空" };
  }

  const latest = item.versions[0];
  const nextVersion = (latest?.version ?? 0) + 1;
  const now = new Date().toISOString();

  await prisma.$transaction([
    prisma.kbItem.update({
      where: { id },
      data: {
        name,
        source: source || null,
        currentVersion: nextVersion,
        updatedAt: now,
      },
    }),
    prisma.kbItemVersion.create({
      data: {
        kbItemId: id,
        version: nextVersion,
        compositionJson: item.type === "formula" ? formatCompositionJson(composition) : null,
        efficacy: String(formData.get("efficacy") ?? "").trim() || null,
        indication: String(formData.get("indication") ?? "").trim() || null,
        usageText: String(formData.get("usageText") ?? "").trim() || null,
        contraindication: String(formData.get("contraindication") ?? "").trim() || null,
        commentary: String(formData.get("commentary") ?? "").trim() || null,
        createdAt: now,
      },
    }),
  ]);

  await writeAudit({
    entityType: "kb_item",
    entityId: id,
    action: "update",
    before: { version: latest?.version ?? 0 },
    after: { version: nextVersion, name, source },
    operatorId: user.id,
  });

  revalidatePath("/kb");
  revalidatePath("/visits", "layout");
  return { ok: true, message: `已保存为第 ${nextVersion} 版（旧版本仍可在版本历史里查）` };
}
