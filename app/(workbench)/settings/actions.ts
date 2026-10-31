"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";

export type SettingsState = { ok?: boolean; error?: string };

export async function saveSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();

  const raw = String(formData.get("backupRetentionDays") ?? "").trim();
  const days = Number(raw);
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    return { error: "保留天数请填 1–3650 之间的整数" };
  }

  const before = await prisma.setting.findUnique({ where: { key: "backup_retention_days" } });
  await prisma.setting.upsert({
    where: { key: "backup_retention_days" },
    create: { key: "backup_retention_days", value: String(days), updatedAt: new Date().toISOString() },
    update: { value: String(days), updatedAt: new Date().toISOString() },
  });

  await writeAudit({
    entityType: "export",
    entityId: "settings:backup_retention_days",
    action: "update",
    before: before ? { value: before.value } : undefined,
    after: { value: String(days) },
    operatorId: user.id,
  });

  revalidatePath("/settings");
  return { ok: true };
}
