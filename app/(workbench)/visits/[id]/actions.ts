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
  await prisma.visitDraft.deleteMany({ where: { visitId } }).catch(() => null);

  return { ok: true, revisionNo: nextNo };
}

/** 自动保存草稿：接诊台打字时每隔几秒存一份，刷新/断电后还能接着写 */
export async function saveDraft(
  visitId: string,
  draft: VisitDraft,
): Promise<{ ok: boolean; savedAt: string | null; message?: string }> {
  const user = await requireUser();
  const visit = await prisma.visit.findUnique({ where: { id: visitId }, select: { id: true } });
  if (!visit) return { ok: false, savedAt: null, message: "就诊记录不存在" };

  const now = new Date().toISOString();
  try {
    await prisma.visitDraft.upsert({
      where: { visitId },
      create: {
        visitId,
        dataJson: JSON.stringify(draft),
        operatorId: user.id,
        createdAt: now,
        updatedAt: now,
      },
      update: { dataJson: JSON.stringify(draft), updatedAt: now },
    });
    return { ok: true, savedAt: now };
  } catch {
    return { ok: false, savedAt: null, message: "草稿保存失败" };
  }
}

export async function clearDraft(visitId: string): Promise<{ ok: boolean }> {
  await requireUser();
  await prisma.visitDraft.deleteMany({ where: { visitId } }).catch(() => null);
  return { ok: true };
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

export type SaveCaseResult = { ok: boolean; message: string };

/**
 * 把已签名病历存成医案（knowledge type="case"）：
 * 名称 = 主诉关键词 · 证型（患者首发），组成取当时处方，方便以后检索与带入。
 */
export async function saveVisitAsCase(visitId: string): Promise<SaveCaseResult> {
  const user = await requireUser();

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      patient: { select: { name: true } },
      revisions: { orderBy: { revisionNo: "desc" }, take: 1 },
    },
  });
  if (!visit) return { ok: false, message: "就诊记录不存在" };

  const revision = visit.revisions[0];
  if (!revision) return { ok: false, message: "还没有签名的病历，先保存并签名" };

  const prescription = await prisma.prescription.findFirst({
    where: { visitRevisionId: revision.id },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { sortNo: "asc" } } },
  });
  if (!prescription || prescription.items.length === 0) {
    return { ok: false, message: "这次没有开方，暂不能存为医案" };
  }

  const chief = (revision.chiefComplaint ?? "").trim();
  const keywords = chief
    .replace(/\s+/g, " ")
    .replace(/[，。；;、,]+/g, " · ")
    .trim()
    .slice(0, 24);
  const name = `${keywords || "病例"}（${revision.syndrome || "未辨证"}）`;
  const source = "我的医案";
  const composition = prescription.items.map((item) => ({
    name: item.herbName,
    dose: item.dose ?? "",
  }));

  const existing = await prisma.kbItem.findFirst({ where: { type: "case", name, source } });
  if (existing) return { ok: false, message: `已经有同名医案「${name}」` };

  const listOf = (raw: string | null) => {
    try {
      const value = JSON.parse(raw || "[]");
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  const now = new Date().toISOString();
  const item = await prisma.kbItem.create({
    data: {
      type: "case",
      name,
      source,
      status: "active",
      currentVersion: 1,
      createdAt: now,
      updatedAt: now,
    },
  });
  await prisma.kbItemVersion.create({
    data: {
      kbItemId: item.id,
      version: 1,
      compositionJson: JSON.stringify(composition),
      efficacy: revision.treatment ?? "",
      indication: [chief, (revision.presentIllness ?? "").slice(0, 120)]
        .filter(Boolean)
        .join("；"),
      usageText: prescription.usageText ?? "",
      commentary: (revision.advice ?? "").slice(0, 200),
      rawJson: JSON.stringify({
        patient: visit.patient.name,
        visitAt: visit.visitAt,
        visitNo: visit.visitNo,
        visitId: visit.id,
        chiefComplaint: revision.chiefComplaint,
        presentIllness: revision.presentIllness,
        syndrome: revision.syndrome,
        treatment: revision.treatment,
        tongue: listOf(revision.tongueJson),
        pulse: listOf(revision.pulseJson),
        symptoms: listOf(revision.symptomsJson),
        advice: revision.advice,
      }),
      createdAt: now,
    },
  });

  const terms = [revision.syndrome ?? "", ...(JSON.parse(revision.symptomsJson || "[]") as string[])]
    .filter(Boolean)
    .slice(0, 8);
  for (const term of terms) {
    await prisma.kbAlias.create({
      data: {
        kbItemId: item.id,
        term,
        normTerm: name,
        aliasType: "case",
        weight: 1,
      },
    });
  }

  await writeAudit({
    entityType: "kb_item",
    entityId: item.id,
    action: "create",
    after: { type: "case", name, fromVisit: visitId },
    operatorId: user.id,
  });

  revalidatePath("/kb");
  revalidatePath("/visits", "layout");
  return { ok: true, message: `已存为医案「${name}」` };
}
