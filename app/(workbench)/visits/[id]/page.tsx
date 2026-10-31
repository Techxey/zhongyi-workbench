import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { emptyDraft, parseDose, type RxLine, type VisitDraft } from "@/lib/visit";
import { VisitScreen, type ConsultationData } from "./consult";

export const dynamic = "force-dynamic";

export type { RxLine };

type LoadedPrescription = {
  formulaName: string | null;
  formulaSource: string | null;
  kbItemId: string | null;
  kbItemVersion: number | null;
  doses: number | null;
  usageText: string | null;
  items: { herbName: string; dose: string | null; doseUnit: string | null; role: string | null }[];
};

async function loadPrescription(revisionId: string | null | undefined): Promise<LoadedPrescription | null> {
  if (!revisionId) return null;
  const rx = await prisma.prescription.findFirst({
    where: { visitRevisionId: revisionId },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { sortNo: "asc" } } },
  });
  if (!rx) return null;
  return {
    formulaName: rx.formulaName,
    formulaSource: rx.formulaSource,
    kbItemId: rx.kbItemId,
    kbItemVersion: rx.kbItemVersion,
    doses: rx.doses,
    usageText: rx.usageText,
    items: rx.items.map((item) => ({
      herbName: item.herbName,
      dose: item.dose,
      doseUnit: item.doseUnit,
      role: item.role,
    })),
  };
}

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      patient: true,
      revisions: {
        orderBy: { revisionNo: "desc" },
      },
    },
  });
  if (!visit) notFound();

  const currentRevision =
    visit.revisions.find((revision) => revision.id === visit.currentRevisionId) ??
    visit.revisions[0] ??
    null;
  const currentRx = await loadPrescription(currentRevision?.id);

  // 上一张病历（同一患者、最近一次已提交的就诊）
  const previous = await prisma.visit.findFirst({
    where: {
      patientId: visit.patientId,
      status: "signed",
      visitNo: { lt: visit.visitNo },
    },
    orderBy: { visitNo: "desc" },
    include: { revisions: { orderBy: { revisionNo: "desc" } } },
  });
  const previousRevision =
    previous?.revisions.find((revision) => revision.id === previous.currentRevisionId) ??
    previous?.revisions[0] ??
    null;
  const previousRx = await loadPrescription(previousRevision?.id);

  const [symptomTerms, syndromeAliases, incompatPairs, clinicSetting] = await Promise.all([
    prisma.symptomTerm.findMany({ orderBy: [{ useCount: "desc" }, { term: "asc" }], take: 12 }),
    prisma.kbAlias.findMany({
      where: { aliasType: "syndrome" },
      include: { item: { select: { name: true } } },
    }),
    prisma.herbIncompatibility.findMany(),
    prisma.setting.findUnique({ where: { key: "clinic_name" } }),
  ]);

  let kbFormula: ConsultationData["kbFormula"] = null;
  if (currentRx?.kbItemId) {
    const item = await prisma.kbItem.findUnique({
      where: { id: currentRx.kbItemId },
      include: { versions: { orderBy: { version: "desc" }, take: 1 } },
    });
    const version = item?.versions[0];
    if (item && version) {
      const composition = safeParseComposition(version.compositionJson);
      kbFormula = {
        id: item.id,
        name: item.name,
        source: item.source,
        efficacy: version.efficacy,
        indication: version.indication,
        commentary: version.commentary,
        usageText: version.usageText,
        items: composition,
        version: version.version,
      };
    }
  }

  const draft: VisitDraft = currentRevision
    ? {
        chiefComplaint: currentRevision.chiefComplaint ?? "",
        presentIllness: currentRevision.presentIllness ?? "",
        symptoms: safeParseList(currentRevision.symptomsJson),
        tongue: safeParseList(currentRevision.tongueJson),
        pulse: safeParseList(currentRevision.pulseJson),
        syndrome: currentRevision.syndrome ?? "",
        treatment: currentRevision.treatment ?? "",
        advice: currentRevision.advice ?? "",
        followupDays:
          currentRevision.followupDays === null || currentRevision.followupDays === undefined
            ? "7"
            : String(currentRevision.followupDays),
        remindFollowup: currentRevision.remindFollowup ?? true,
        amendedReason: "",
        prescription: currentRx
          ? {
              formulaName: currentRx.formulaName ?? "",
              formulaSource: currentRx.formulaSource ?? "",
              kbItemId: currentRx.kbItemId,
              kbItemVersion: currentRx.kbItemVersion,
              doses: currentRx.doses === null ? "7" : String(currentRx.doses),
              usageText: currentRx.usageText ?? "",
              items: currentRx.items.map((item, index) => {
                const parsed = item.doseUnit
                  ? { value: item.dose?.replace(/[^\d.]/g, "") ?? "", unit: item.doseUnit }
                  : parseDose(item.dose);
                return {
                  key: `saved-${index}`,
                  name: item.herbName,
                  doseValue: parsed.value,
                  doseUnit: parsed.unit,
                  role: item.role,
                };
              }),
            }
          : emptyDraft().prescription,
      }
    : emptyDraft();

  const data: ConsultationData = {
    visitId: visit.id,
    patient: {
      id: visit.patient.id,
      name: visit.patient.name,
      gender: visit.patient.gender,
      birthYear: visit.patient.birthYear,
      allergy: visit.patient.allergy,
      constitution: visit.patient.constitution,
      pastHistory: visit.patient.pastHistory,
    },
    visitNo: visit.visitNo,
    visitAt: visit.visitAt,
    status: visit.status,
    revisionNo: visit.revisions.length,
    doctorName: user.name,
    clinicName: clinicSetting?.value || "中医诊所",
    draft,
    isAmend: visit.revisions.length > 0,
    previous: previousRevision
      ? {
          visitAt: previous!.visitAt,
          presentIllness: previousRevision.presentIllness ?? "",
          symptoms: safeParseList(previousRevision.symptomsJson),
          tongue: safeParseList(previousRevision.tongueJson),
          pulse: safeParseList(previousRevision.pulseJson),
          syndrome: previousRevision.syndrome ?? "",
          treatment: previousRevision.treatment ?? "",
          advice: previousRevision.advice ?? "",
          followupDays: previousRevision.followupDays,
          remindFollowup: previousRevision.remindFollowup ?? true,
          items: (previousRx?.items ?? []).map((item) => ({
            name: item.herbName,
            dose: item.dose ?? "",
          })),
          formulaName: previousRx?.formulaName ?? "",
          usageText: previousRx?.usageText ?? "",
          doses: previousRx?.doses ?? null,
        }
      : null,
    symptomTerms: symptomTerms.map((term) => ({ term: term.term, count: term.useCount })),
    syndromeAliases: syndromeAliases.map((alias) => ({
      label: alias.normTerm || alias.term,
      term: alias.term,
      normTerm: alias.normTerm,
      weight: alias.weight,
    })),
    incompatPairs: incompatPairs.map((pair) => ({
      herbA: pair.herbA,
      herbB: pair.herbB,
      rule: pair.rule,
    })),
    kbFormula,
  };

  return <VisitScreen data={data} />;
}

function safeParseList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function safeParseComposition(raw: string | null | undefined): RxLine[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry) => entry && typeof entry === "object")
      .map((entry) => ({
        name: String((entry as { name?: unknown }).name ?? ""),
        dose: String((entry as { dose?: unknown }).dose ?? ""),
      }))
      .filter((entry) => entry.name);
  } catch {
    return [];
  }
}
