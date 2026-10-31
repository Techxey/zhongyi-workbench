import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ageOf, formatDate, genderLabel } from "@/lib/format";
import { printPageStyle } from "@/lib/print";
import { loadPrintOptions } from "@/lib/print-server";
import { BackLink, PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

export default async function PrescriptionPrintPage({
  params,
}: {
  params: Promise<{ visitId: string }>;
}) {
  await requireUser();
  const { visitId } = await params;
  const print = await loadPrintOptions();
  const pageStyle = <style dangerouslySetInnerHTML={{ __html: printPageStyle(print) }} />;

  const visit = await prisma.visit.findUnique({
    where: { id: visitId },
    include: {
      patient: true,
      revisions: { orderBy: { revisionNo: "desc" }, take: 1 },
    },
  });
  if (!visit) notFound();

  const revision = visit.revisions[0];
  if (!revision) {
    return (
      <div className="print-page">
        {pageStyle}
        <div className="print-toolbar no-print">
          <BackLink />
        </div>
        <div className="sheet">
          <p className="clinic">中医处方笺</p>
          <p className="clinic-sub">尚未填写病历，无法打印</p>
        </div>
      </div>
    );
  }

  const prescription = await prisma.prescription.findFirst({
    where: { visitRevisionId: revision.id },
    orderBy: { createdAt: "desc" },
    include: { items: { orderBy: { sortNo: "asc" } } },
  });

  const clinic = await prisma.setting.findUnique({ where: { key: "clinic_name" } });
  const clinicName = clinic?.value?.trim() || "中医诊所";
  const clinicDoctor = await prisma.setting.findUnique({ where: { key: "clinic_doctor" } });
  const doctor = await prisma.user.findUnique({
    where: { id: revision.operatorId },
    select: { displayName: true },
  });
  const doctorName = clinicDoctor?.value?.trim() || doctor?.displayName || "";

  const symptoms = parseList(revision.symptomsJson);
  const tongue = parseList(revision.tongueJson);
  const pulse = parseList(revision.pulseJson);
  const fourDiagnosis = [
    tongue.length > 0 ? `舌象：${tongue.join("、")}` : null,
    pulse.length > 0 ? `脉象：${pulse.join("、")}` : null,
    symptoms.length > 0 ? `问诊：${symptoms.join("、")}` : null,
  ]
    .filter(Boolean)
    .join("　");

  const items = prescription?.items ?? [];

  return (
    <div className="print-page">
      {pageStyle}
      <div className="print-toolbar no-print">
        <BackLink />
        <PrintButton />
      </div>

      <div className="sheet">
        <p className="clinic">{clinicName}</p>
        <p className="clinic-sub">处 方 笺</p>

        <div className="meta">
          <span>编号：{String(revision.revisionNo > 1 ? `${visit.visitNo}-${revision.revisionNo}` : visit.visitNo).padStart(4, "0")}</span>
          <span>日期：{formatDate(visit.visitAt)}</span>
        </div>

        <div className="patient">
          <span>
            姓名：<b>{visit.patient.name}</b>
          </span>
          <span>{genderLabel(visit.patient.gender)}</span>
          <span>{visit.patient.birthYear ? `${ageOf(visit.patient.birthYear)}` : "年龄未填"}</span>
          {print.showPhone && visit.patient.phone ? (
            <span>电话 {maskedTail(visit.patient.phone)}</span>
          ) : null}
        </div>

        <div className="diagnosis">
          <div>
            <span className="k">诊断（证型）：</span>
            {revision.syndrome || "—"}
          </div>
          <div>
            <span className="k">治法：</span>
            {revision.treatment || "—"}
          </div>
          {print.showFourDiagnosis && fourDiagnosis ? (
            <div>
              <span className="k">四诊：</span>
              {fourDiagnosis}
            </div>
          ) : null}
          {revision.amendedReason ? (
            <div>
              <span className="k">修订：</span>第 {revision.revisionNo} 版（{revision.amendedReason}）
            </div>
          ) : null}
        </div>

        <p className="rx-title">处 方</p>
        <div className="rx-grid">
          {items.length === 0 ? (
            <div className="rx-item">
              <span className="name">（未开药）</span>
            </div>
          ) : (
            items.map((item) => (
              <div className="rx-item" key={item.id}>
                <span className="name">{item.herbName}</span>
                <span>{item.dose ?? ""}</span>
              </div>
            ))
          )}
        </div>

        <div className="usage">
          <div>
            共 {items.length} 味 · 付数：{prescription?.doses ?? "—"} 剂
          </div>
          <div>用法：{prescription?.usageText || "每日 1 剂，水煎 400ml，分早晚温服"}</div>
          {revision.advice ? <div className="advice">医嘱：{revision.advice}</div> : null}
        </div>

        <div className="sign">
          <span>医师：{doctorName}</span>
          <span>签名：________________</span>
          <span>日期：{formatDate(visit.visitAt)}</span>
        </div>

        {print.footer ? <p className="foot">{print.footer}</p> : null}
      </div>
    </div>
  );
}

function parseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

/** 打印件只印手机号后四位，避免整份处方带着完整联系方式流传 */
function maskedTail(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 4 ? `****${digits.slice(-4)}` : phone;
}
