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

const CLINIC_FIELDS = [
  { key: "clinic_name", label: "诊所名称", max: 40 },
  { key: "clinic_doctor", label: "医生署名", max: 20 },
  { key: "default_usage", label: "默认用法", max: 60 },
] as const;

/** 诊所信息：诊所名（打印页抬头）、医生署名、处方默认用法 */
export async function saveClinic(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();

  const values: Record<string, string> = {};
  for (const field of CLINIC_FIELDS) {
    const value = String(formData.get(field.key) ?? "").trim();
    if (value.length > field.max) return { error: `${field.label}最多 ${field.max} 个字` };
    values[field.key] = value;
  }
  if (!values.clinic_name) return { error: "诊所名称不能为空" };

  for (const field of CLINIC_FIELDS) {
    const before = await prisma.setting.findUnique({ where: { key: field.key } });
    await prisma.setting.upsert({
      where: { key: field.key },
      create: { key: field.key, value: values[field.key], updatedAt: new Date().toISOString() },
      update: { value: values[field.key], updatedAt: new Date().toISOString() },
    });
    await writeAudit({
      entityType: "export",
      entityId: `settings:${field.key}`,
      action: "update",
      before: before ? { value: before.value } : undefined,
      after: { value: values[field.key] },
      operatorId: user.id,
    });
  }

  revalidatePath("/settings");
  revalidatePath("/visits", "layout");
  revalidatePath("/print", "layout");
  return { ok: true };
}
