"use server";

import { compare, hash } from "bcryptjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser, destroySession } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { createBackup, pruneBackups } from "@/lib/backup";
import { PRINT_OPTIONS_KEY } from "@/lib/print-server";

export type SettingsState = { ok?: boolean; error?: string; message?: string };

/** 立即备份一份 dev.db（VACUUM INTO 快照），并按保留天数清理 */
export async function backupNow(): Promise<SettingsState> {
  const user = await requireUser();
  const file = await createBackup();
  const removed = await pruneBackups();
  await writeAudit({
    entityType: "export",
    entityId: `backup:${file.name}`,
    action: "create",
    after: { name: file.name, size: file.size, pruned: removed },
    operatorId: user.id,
  });
  revalidatePath("/settings");
  return { ok: true, message: `已备份 ${file.name}` };
}

/** 改密码：校验旧密码，改完清掉当前会话，强制重新登录 */
export async function changePassword(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();
  const current = String(formData.get("currentPassword") ?? "");
  const next = String(formData.get("newPassword") ?? "");
  const confirm = String(formData.get("confirmPassword") ?? "");

  if (!current || !next) return { error: "当前密码和新密码都要填" };
  if (next.length < 8) return { error: "新密码至少 8 位" };
  if (next !== confirm) return { error: "两次输入的新密码不一致" };
  if (next === current) return { error: "新密码不能和当前密码相同" };

  const row = await prisma.user.findUnique({ where: { id: user.id } });
  if (!row) return { error: "账号不存在" };
  if (!(await compare(current, row.passwordHash))) return { error: "当前密码不对" };

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await hash(next, 10) },
  });
  await writeAudit({
    entityType: "export",
    entityId: `user:${user.id}`,
    action: "update",
    after: { passwordChanged: true },
    operatorId: user.id,
  });

  await destroySession();
  revalidatePath("/settings");
  redirect("/login?passwordChanged=1");
}


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

/** 打印版式：纸张、字号、显示项、页脚声明，存在 Setting print_options（JSON） */
export async function savePrintSettings(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await requireUser();

  const paper = String(formData.get("paper") ?? "A5") === "A4" ? "A4" : "A5";
  const fontSizeRaw = String(formData.get("fontSize") ?? "normal");
  const fontSize =
    fontSizeRaw === "small" || fontSizeRaw === "large" ? fontSizeRaw : "normal";
  const footer = String(formData.get("footer") ?? "").trim();
  if (footer.length > 160) return { error: "页脚声明最多 160 个字" };

  const next = {
    paper,
    fontSize,
    showFourDiagnosis: formData.get("showFourDiagnosis") === "on",
    showPhone: formData.get("showPhone") === "on",
    footer,
  };

  const before = await prisma.setting.findUnique({ where: { key: PRINT_OPTIONS_KEY } });
  await prisma.setting.upsert({
    where: { key: PRINT_OPTIONS_KEY },
    create: {
      key: PRINT_OPTIONS_KEY,
      value: JSON.stringify(next),
      updatedAt: new Date().toISOString(),
    },
    update: { value: JSON.stringify(next), updatedAt: new Date().toISOString() },
  });
  await writeAudit({
    entityType: "export",
    entityId: `settings:${PRINT_OPTIONS_KEY}`,
    action: "update",
    before: before ? { value: before.value } : undefined,
    after: { value: JSON.stringify(next) },
    operatorId: user.id,
  });

  revalidatePath("/settings");
  revalidatePath("/print", "layout");
  return { ok: true };
}
