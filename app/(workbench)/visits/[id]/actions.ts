"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import {
  findIncompatibilities,
  formatDose,
  herbLines,
  isNumericDose,
  validateDraft,
  type VisitDraft,
} from "@/lib/visit";

export type SaveVisitResult =
  | { ok: true; revisionNo: number }
  | { ok: false; errors: { field: string; message: string }[] };

export async function saveVisit(visitId: string, draft: VisitDraft): Promise<SaveVisitResult> {
  const user = await requireUser();

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: { revisions: { orderBy: { revisionNo: "desc" }, take: 1 } },
  });
  if (!visit) {
    return { ok: false, errors: [{ field: "", message: "就诊记录不存在，可能已被删除" }] };
  }

  const isAmend = visit.revisions.length > 0;
  const errors = validateDraft(draft, isAmend);
  if (errors.length > 0) return { ok: false, errors };

  const items = draft.prescription.items.filter((item) => item.name.trim());
  const badDose = items.find((item) => !isNumericDose(item.doseValue));
  if (badDose) {
    return {
      ok: false,
      errors: [{ field: "items", message: `「${badDose.name}」的剂量不是有效数字` }],
    };
  }

  const now = new Date().toISOString();
  const nextNo = (visit.revisions[0]?.revisionNo ?? 0) + 1;
  const parentRevisionId = visit.revisions[0]?.id ?? null;

  const incompatibilities = findIncompatibilities(
    items.map((item) => item.name.trim()),
    await prisma.herbIncompatibility.findMany(),
  );

  const created = await prisma.$transaction(async (tx) => {
    const revision = await tx.visitRevision.create({
      data: {
        visitId: visit.id,
        revisionNo: nextNo,
        parentRevisionId,
        chiefComplaint: draft.chiefComplaint.trim(),
        presentIllness: draft.presentIllness.trim() || null,
        symptomsJson: JSON.stringify(draft.symptoms),
        tongueJson: JSON.stringify(draft.tongue),
        pulseJson: JSON.stringify(draft.pulse),
        syndrome: draft.syndrome.trim(),
        treatment: draft.treatment.trim() || null,
        advice: draft.advice.trim() || null,
        followupDays: draft.followupDays.trim() ? Number(draft.followupDays.trim()) : null,
        remindFollowup: draft.remindFollowup,
        amendedReason: isAmend ? draft.amendedReason.trim() : null,
        operatorId: user.id,
        createdAt: now,
      },
    });

    const prescription = await tx.prescription.create({
      data: {
        visitRevisionId: revision.id,
        formulaName: draft.prescription.formulaName.trim() || null,
        formulaSource: draft.prescription.formulaSource.trim() || null,
        kbItemId: draft.prescription.kbItemId,
        kbItemVersion: draft.prescription.kbItemVersion,
        doses: draft.prescription.doses.trim() ? Number(draft.prescription.doses.trim()) : null,
        usageText: draft.prescription.usageText.trim() || null,
        snapshotJson: JSON.stringify({
          formulaName: draft.prescription.formulaName.trim(),
          items: herbLines(draft.prescription.items),
          usageText: draft.prescription.usageText.trim(),
        }),
        createdAt: now,
      },
    });

    await tx.prescriptionItem.createMany({
      data: items.map((item, index) => ({
        prescriptionId: prescription.id,
        herbName: item.name.trim(),
        dose: formatDose(item.doseValue, item.doseUnit),
        doseValue: Number(item.doseValue),
        doseUnit: item.doseUnit.trim() || "g",
        role: item.role,
        sortNo: index,
      })),
    });

    await tx.visit.update({
      where: { id: visit.id },
      data: { status: "signed", currentRevisionId: revision.id },
    });

    // 问诊要点词频：下次取前 12 个时更贴近这位医生的习惯
    for (const symptom of draft.symptoms) {
      await tx.symptomTerm.upsert({
        where: { normTerm: symptom },
        create: { term: symptom, normTerm: symptom, useCount: 1, createdAt: now },
        update: { useCount: { increment: 1 } },
      });
    }

    return revision;
  });

  await writeAudit({
    entityType: "visit_revision",
    entityId: created.id,
    action: isAmend ? "amend" : "sign",
    after: {
      visitId: visit.id,
      revisionNo: nextNo,
      amendedReason: isAmend ? draft.amendedReason.trim() : null,
      syndrome: draft.syndrome.trim(),
      formulaName: draft.prescription.formulaName.trim(),
      items: herbLines(draft.prescription.items),
      incompatibilities,
    },
    operatorId: user.id,
  });

  if (incompatibilities.length > 0) {
    await writeAudit({
      entityType: "visit",
      entityId: visit.id,
      action: "update",
      after: { note: "配伍提示（十八反/十九畏）", incompatibilities },
      operatorId: user.id,
    });
  }

  revalidatePath(`/visits/${visitId}`);
  revalidatePath(`/patients/${visit.patientId}`);

  return { ok: true, revisionNo: nextNo };
}

export type SaveTemplateResult = { ok: true; name: string } | { ok: false; message: string };

/** 存为我的常用方 / 另存为协定处方 */
export async function saveAsTemplate(
  visitId: string,
  kind: "favorite" | "agreed",
): Promise<SaveTemplateResult> {
  const user = await requireUser();

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      revisions: { orderBy: { revisionNo: "desc" }, take: 1 },
    },
  });
  const revision = visit?.revisions[0];
  if (!visit || !revision) return { ok: false, message: "请先保存本次病历" };

  const rx = await prisma.prescription.findFirst({
    where: { visitRevisionId: revision.id },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { sortNo: "asc" } } },
  });
  if (!rx || rx.items.length === 0) return { ok: false, message: "处方还是空的" };

  const name = rx.formulaName?.trim() || `经验方 ${new Date().toISOString().slice(0, 10)}`;
  const label = kind === "favorite" ? `我的常用方 · ${name}` : `协定处方 · ${name}`;
  const now = new Date().toISOString();

  await prisma.templatePrescription.create({
    data: {
      kind,
      name,
      formulaName: rx.formulaName,
      formulaSource: rx.formulaSource,
      compositionJson: JSON.stringify(rx.items.map((item) => ({ name: item.herbName, dose: item.dose }))),
      usageText: rx.usageText,
      createdBy: user.id,
      createdAt: now,
      items: {
        create: rx.items.map((item, index) => ({
          herbName: item.herbName,
          dose: item.dose,
          doseValue: item.doseValue,
          doseUnit: item.doseUnit,
          sortNo: index,
        })),
      },
    },
  });

  await writeAudit({
    entityType: "prescription",
    entityId: rx.id,
    action: "create",
    after: { template: kind, label },
    operatorId: user.id,
  });

  revalidatePath(`/visits/${visitId}`);
  return { ok: true, name: label };
}

export type DeleteTemplateResult = { ok: boolean; message: string };

/** 删除常用方 / 协定处方：只删模板，不动任何已保存病历 */
export async function deleteTemplate(id: string): Promise<DeleteTemplateResult> {
  const user = await requireUser();
  const template = await prisma.templatePrescription.findUnique({ where: { id } });
  if (!template) return { ok: false, message: "这个方已经删过了" };

  await prisma.$transaction([
    prisma.templateItem.deleteMany({ where: { templateId: id } }),
    prisma.templatePrescription.delete({ where: { id } }),
  ]);

  await prisma.auditLog.create({
    data: {
      entityType: "prescription",
      entityId: id,
      action: "delete",
      beforeJson: JSON.stringify({ name: template.name, kind: template.kind }),
      afterJson: null,
      operatorId: user.id,
      createdAt: new Date().toISOString(),
    },
  });

  revalidatePath("/visits", "layout");
  return { ok: true, message: `已删除「${template.name}」` };
}
