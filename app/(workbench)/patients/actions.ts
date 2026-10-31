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
  console.log("[createPatient] user=", user?.id, "keys=", [...formData.keys()]);
  const parsed = patientInputSchema.safeParse(readPatientForm(formData));
  if (!parsed.success) {
    console.log("[createPatient] invalid", JSON.stringify(parsed.error.issues));
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
