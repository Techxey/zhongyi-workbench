"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  fieldErrorsOf,
  patientInputSchema,
  type FormState,
  type PatientFormRaw,
} from "@/lib/validation";

function readPatientForm(formData: FormData): PatientFormRaw {
  return {
    name: String(formData.get("name") ?? ""),
    gender: String(formData.get("gender") ?? ""),
    birthYear: String(formData.get("birthYear") ?? ""),
    phone: String(formData.get("phone") ?? ""),
    constitution: String(formData.get("constitution") ?? ""),
    allergy: String(formData.get("allergy") ?? ""),
    pastHistory: String(formData.get("pastHistory") ?? ""),
    note: String(formData.get("note") ?? ""),
  };
}

export async function createPatient(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = patientInputSchema.safeParse(readPatientForm(formData));
  if (!parsed.success) {
    return { status: "error", message: "请检查标红的字段", fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const now = new Date().toISOString();
  const patient = await prisma.patient.create({
    data: { ...parsed.data, createdAt: now, updatedAt: now },
  });

  await writeAudit({
    entityType: "patient",
    entityId: patient.id,
    action: "create",
    after: parsed.data,
    operatorId: user.id,
  });

  revalidatePath("/patients");
  redirect(`/patients/${patient.id}`);
}

export async function updatePatient(
  patientId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = patientInputSchema.safeParse(readPatientForm(formData));
  if (!parsed.success) {
    return { status: "error", message: "请检查标红的字段", fieldErrors: fieldErrorsOf(parsed.error) };
  }

  const before = await prisma.patient.findUnique({ where: { id: patientId } });
  if (!before) return { status: "error", message: "患者不存在" };

  await prisma.patient.update({
    where: { id: patientId },
    data: { ...parsed.data, updatedAt: new Date().toISOString() },
  });

  await writeAudit({
    entityType: "patient",
    entityId: patientId,
    action: "update",
    before,
    after: parsed.data,
    operatorId: user.id,
  });

  revalidatePath(`/patients/${patientId}`);
  revalidatePath("/patients");
  return { status: "ok", id: patientId };
}

/** 从患者详情页进入接诊台：已有草稿就诊则续用，否则按 visit_no 顺延新建 */
export async function startVisit(patientId: string): Promise<void> {
  const user = await requireUser();
  const patient = await prisma.patient.findUnique({ where: { id: patientId }, select: { id: true } });
  if (!patient) redirect("/patients");

  const draft = await prisma.visit.findFirst({
    where: { patientId, status: "draft" },
    orderBy: { visitAt: "desc" },
    select: { id: true },
  });
  if (draft) redirect(`/visits/${draft.id}`);

  const last = await prisma.visit.findFirst({
    where: { patientId },
    orderBy: { visitNo: "desc" },
    select: { visitNo: true },
  });
  const now = new Date().toISOString();
  const visit = await prisma.visit.create({
    data: {
      patientId,
      visitNo: (last?.visitNo ?? 0) + 1,
      visitAt: now,
      status: "draft",
      createdAt: now,
    },
  });

  await writeAudit({
    entityType: "visit",
    entityId: visit.id,
    action: "create",
    after: { patientId, visitNo: visit.visitNo, status: "draft" },
    operatorId: user.id,
  });

  revalidatePath(`/patients/${patientId}`);
  redirect(`/visits/${visit.id}`);
}

/** 手机号默认脱敏，医生主动"查看完整"时写一条审计 */
export async function revealPhone(patientId: string): Promise<{ phone: string | null }> {
  const user = await requireUser();
  const patient = await prisma.patient.findUnique({
    where: { id: patientId },
    select: { phone: true },
  });

  if (!patient?.phone) return { phone: null };

  await writeAudit({
    entityType: "patient",
    entityId: patientId,
    action: "view_pii",
    after: { field: "phone" },
    operatorId: user.id,
  });

  return { phone: patient.phone };
}
