import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TopBar } from "@/components/topbar";
import { ageOf, formatDateTime, genderLabel } from "@/lib/format";
import { diffPrescription, type RxLine } from "@/lib/visit";

export const dynamic = "force-dynamic";

type FieldChange = { label: string; before: string; after: string };

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => String(item));
  } catch {
    return [];
  }
  return [];
}

function textOf(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function joinList(list: string[]): string {
  return list.length ? list.join("、") : "";
}

export default async function RevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;

  const visit = await prisma.visit.findUnique({
    where: { id },
    include: {
      patient: true,
      revisions: {
        orderBy: { revisionNo: "asc" },
        include: { prescriptions: { include: { items: { orderBy: { sortNo: "asc" } } } } },
      },
    },
  });
  if (!visit) notFound();

  const operatorIds = [
    ...new Set(visit.revisions.map((revision) => revision.operatorId).filter(Boolean)),
  ].filter((value): value is string => Boolean(value));
  const operators = operatorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: operatorIds } },
        select: { id: true, displayName: true },
      })
    : [];
  const nameOf = new Map(operators.map((operator) => [operator.id, operator.displayName]));

  const rows = visit.revisions.map((revision, index) => {
    const previous = index > 0 ? visit.revisions[index - 1] : null;
    const rx = revision.prescriptions[0] ?? null;
    const previousRx = previous?.prescriptions[0] ?? null;
    const toLines = (prescription: { items: { herbName: string; dose: string | null }[] } | null): RxLine[] =>
      (prescription?.items ?? []).map((item) => ({ name: item.herbName, dose: item.dose ?? "" }));
    const rxDiff = diffPrescription(toLines(previousRx), toLines(rx));

    const fieldPairs: { label: string; before: string; after: string }[] = previous
      ? [
          { label: "主诉", before: textOf(previous.chiefComplaint), after: textOf(revision.chiefComplaint) },
          {
            label: "现病史",
            before: textOf(previous.presentIllness),
            after: textOf(revision.presentIllness),
          },
          {
            label: "问诊要点",
            before: joinList(parseList(previous.symptomsJson)),
            after: joinList(parseList(revision.symptomsJson)),
          },
          {
            label: "舌象",
            before: joinList(parseList(previous.tongueJson)),
            after: joinList(parseList(revision.tongueJson)),
          },
          {
            label: "脉象",
            before: joinList(parseList(previous.pulseJson)),
            after: joinList(parseList(revision.pulseJson)),
          },
          { label: "证型", before: textOf(previous.syndrome), after: textOf(revision.syndrome) },
          { label: "治法", before: textOf(previous.treatment), after: textOf(revision.treatment) },
          { label: "医嘱", before: textOf(previous.advice), after: textOf(revision.advice) },
          {
            label: "复诊",
            before: previous.followupDays ? `${previous.followupDays} 天后` : "",
            after: revision.followupDays ? `${revision.followupDays} 天后` : "",
          },
        ]
      : [];

    const changes: FieldChange[] = fieldPairs.filter((pair) => pair.before !== pair.after);

    return {
      id: revision.id,
      revisionNo: revision.revisionNo,
      createdAt: revision.createdAt,
      operator: nameOf.get(revision.operatorId ?? "") ?? "医生",
      amendedReason: revision.amendedReason,
      formulaName: rx?.formulaName ?? "",
      itemCount: rx?.items.length ?? 0,
      changes,
      rxDiff,
      isFirst: index === 0,
    };
  });

  const latestFirst = [...rows].reverse();

  return (
    <div className="min-h-screen bg-canvas pb-16">
      <TopBar
        title={`${visit.patient.name} · 修订历史`}
        subtitle={`${genderLabel(visit.patient.gender)}${
          visit.patient.birthYear ? ` · ${ageOf(visit.patient.birthYear)}` : ""
        } · 第 ${visit.visitNo} 次接诊 · 共 ${rows.length} 个版本`}
        actions={
          <>
            <Link href={`/visits/${visit.id}`} className="btn btn-quiet">
              回到接诊台
            </Link>
            <Link href={`/patients/${visit.patientId}`} className="btn btn-ghost">
              患者档案
            </Link>
          </>
        }
      />

      <div className="px-[26px] pt-4 max-w-[860px]">
        <p className="text-[12px] text-ink-3 mb-3">
          病历一经签名不可原地修改，每次修订都会生成一个新版本；下面是每个版本与上一版的差异。
        </p>

        {latestFirst.length === 0 ? (
          <div className="card p-8 text-center text-[13px] text-ink-3">这份病历还没有保存过。</div>
        ) : null}

        <ul className="space-y-[10px]">
          {latestFirst.map((row) => (
            <li key={row.id} className="card p-4">
              <div className="flex items-baseline justify-between gap-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-[14px] font-medium text-ink">第 {row.revisionNo} 版</span>
                  {row.revisionNo === rows.length ? (
                    <span className="chip chip-brand">当前</span>
                  ) : null}
                  <span className="text-[12px] text-ink-3 num">{formatDateTime(row.createdAt)}</span>
                  <span className="text-[12px] text-ink-4">{row.operator}</span>
                </div>
                <span className="text-[12px] text-ink-4 num">
                  {row.formulaName ? `${row.formulaName} · ${row.itemCount} 味` : "未填处方"}
                </span>
              </div>

              {row.amendedReason ? (
                <p className="mt-2 rounded-[6px] bg-accent px-2.5 py-1.5 text-[12px] text-accent-ink">
                  修订原因：{row.amendedReason}
                </p>
              ) : null}

              {row.isFirst ? (
                <p className="mt-2 text-[12.5px] text-ink-3">首诊版本，没有上一版可比。</p>
              ) : row.changes.length === 0 && row.rxDiff.empty ? (
                <p className="mt-2 text-[12.5px] text-ink-3">与上一版完全一致。</p>
              ) : (
                <div className="mt-2.5 space-y-1.5">
                  {row.changes.map((change) => (
                    <div key={change.label} className="grid grid-cols-[64px_1fr] gap-2 text-[12.5px]">
                      <span className="text-ink-4">{change.label}</span>
                      <span className="text-ink-2">
                        <span className="text-ink-4 line-through decoration-ink-4/40">
                          {change.before || "（空）"}
                        </span>
                        <span className="mx-1.5 text-ink-4">→</span>
                        <span className="text-ink">{change.after || "（清空）"}</span>
                      </span>
                    </div>
                  ))}

                  {!row.rxDiff.empty ? (
                    <div className="grid grid-cols-[64px_1fr] gap-2 text-[12.5px]">
                      <span className="text-ink-4">处方</span>
                      <span className="text-ink-2 space-y-0.5">
                        {row.rxDiff.added.length ? (
                          <span className="block">
                            <span className="text-brand">加 </span>
                            {row.rxDiff.added.map((item) => `${item.name} ${item.dose}`).join("、")}
                          </span>
                        ) : null}
                        {row.rxDiff.removed.length ? (
                          <span className="block">
                            <span className="text-danger">减 </span>
                            {row.rxDiff.removed.map((item) => item.name).join("、")}
                          </span>
                        ) : null}
                        {row.rxDiff.changed.length ? (
                          <span className="block">
                            <span className="text-accent-ink">改 </span>
                            {row.rxDiff.changed
                              .map((item) => `${item.name} ${item.from}→${item.to}`)
                              .join("、")}
                          </span>
                        ) : null}
                      </span>
                    </div>
                  ) : null}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
