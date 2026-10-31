import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TopBar } from "@/components/topbar";
import { ageOf, formatDate, genderLabel, truncate } from "@/lib/format";
import { PatientInfoCard, type PatientDetail } from "./patient-info-card";
import { startVisit } from "../actions";

export const dynamic = "force-dynamic";

type TimelineEntry = {
  visitId: string;
  visitAt: string;
  status: string;
  revisionNo: number;
  chiefComplaint: string | null;
  syndrome: string | null;
  formulaName: string | null;
};

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireUser();
  const { id } = await params;

  const patient = await prisma.patient.findUnique({
    where: { id },
    include: {
      visits: {
        orderBy: { visitAt: "desc" },
        include: {
          revisions: {
            orderBy: { revisionNo: "desc" },
            include: {
              prescriptions: {
                select: { formulaName: true },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  if (!patient) notFound();

  const timeline: TimelineEntry[] = patient.visits.map((visit) => {
    const current =
      visit.revisions.find((r) => r.id === visit.currentRevisionId) ?? visit.revisions[0];
    return {
      visitId: visit.id,
      visitAt: visit.visitAt,
      status: visit.status,
      revisionNo: current?.revisionNo ?? 1,
      chiefComplaint: current?.chiefComplaint ?? null,
      syndrome: current?.syndrome ?? null,
      formulaName: current?.prescriptions[0]?.formulaName ?? null,
    };
  });

  const draftVisit = patient.visits.find((visit) => visit.status === "draft") ?? null;

  const detail: PatientDetail = {
    id: patient.id,
    name: patient.name,
    gender: patient.gender,
    birthYear: patient.birthYear,
    phone: patient.phone,
    constitution: patient.constitution,
    allergy: patient.allergy,
    pastHistory: patient.pastHistory,
    note: patient.note,
    createdAt: patient.createdAt,
    updatedAt: patient.updatedAt,
  };

  return (
    <>
      <TopBar
        title={
          <span className="flex items-baseline gap-3">
            <Link href="/patients" className="text-[12.5px] text-ink-3 hover:text-brand font-normal">
              患者
            </Link>
            <span className="text-ink-4 font-normal">/</span>
            <span className="font-serif text-[19px]">{patient.name}</span>
            <span className="text-[12.5px] text-ink-3 font-normal">
              {genderLabel(patient.gender)}
              {patient.birthYear ? ` · ${ageOf(patient.birthYear)}` : ""}
            </span>
          </span>
        }
        actions={
          <>
            <Link href="/patients" className="btn btn-ghost">
              返回列表
            </Link>
            <form action={startVisit.bind(null, patient.id)}>
              <button type="submit" className="btn btn-primary">
                {draftVisit ? "继续接诊" : "开始接诊"}
              </button>
            </form>
          </>
        }
      />

      <div className="px-[26px] py-6">
        <div className="grid grid-cols-[minmax(0,1fr)_312px] gap-5 items-start">
          <div className="space-y-5 min-w-0">
            <PatientInfoCard patient={detail} />

            <section className="card">
              <div className="flex items-center justify-between px-4 h-[46px] border-b border-line-2">
                <h2 className="section-title">就诊时间轴</h2>
                <span className="text-[11.5px] text-ink-4 num">
                  {timeline.length > 0 ? `共 ${timeline.length} 次` : ""}
                </span>
              </div>

              {timeline.length === 0 ? (
                <div className="mx-4 my-4 border border-dashed border-line rounded-[10px] px-6 py-12 text-center">
                  <p className="font-serif text-[15px] text-ink mb-1.5">还没有就诊记录</p>
                  <p className="text-[12.5px] text-ink-3 leading-relaxed max-w-[400px] mx-auto">
                    这次接诊会在这里留下日期、主诉、证型与方名，点开即可续诊；病历提交后不可原地改，只能新增修订版。
                  </p>
                  <form action={startVisit.bind(null, patient.id)} className="mt-4">
                    <button type="submit" className="btn btn-primary">
                      开始接诊
                    </button>
                  </form>
                </div>
              ) : (
                <ul>
                  {timeline.map((entry) => (
                    <li key={entry.visitId} className="border-b border-line-2 last:border-b-0">
                      <Link
                        href={`/visits/${entry.visitId}`}
                        className="flex items-center gap-5 px-4 py-3 hover:bg-ghost transition-colors"
                      >
                        <span className="w-[86px] shrink-0 text-[12.5px] text-ink-2 num">
                          {formatDate(entry.visitAt)}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-[13.5px] text-ink truncate">
                            {truncate(entry.chiefComplaint, 40) || "（未填主诉）"}
                          </span>
                          <span className="mt-1 flex items-center gap-2 text-[12px] text-ink-3">
                            {entry.syndrome ? (
                              <span className="chip chip-brand">{entry.syndrome}</span>
                            ) : null}
                            {entry.formulaName ? (
                              <span className="font-serif text-ink-2">{entry.formulaName}</span>
                            ) : null}
                            {entry.status === "draft" ? (
                              <span className="chip">未提交</span>
                            ) : null}
                          </span>
                        </span>
                        <span className="text-[11.5px] text-ink-4">
                          {entry.revisionNo > 1 ? `第 ${entry.revisionNo} 版` : ""}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          <aside className="space-y-4">
            <section className="card p-4">
              <h3 className="text-[12px] text-ink-3 mb-1.5 tracking-wide">过敏史</h3>
              {patient.allergy ? (
                <p className="text-[13.5px] text-danger leading-relaxed">{patient.allergy}</p>
              ) : (
                <p className="text-[13px] text-ink-4">否认</p>
              )}
            </section>

            <section className="card p-4">
              <h3 className="text-[12px] text-ink-3 mb-1.5 tracking-wide">既往史</h3>
              <p className="text-[13px] text-ink-2 leading-relaxed whitespace-pre-wrap">
                {patient.pastHistory || <span className="text-ink-4">未记录</span>}
              </p>
            </section>

            <section className="card p-4">
              <h3 className="text-[12px] text-ink-3 mb-1.5 tracking-wide">体质辨识</h3>
              {patient.constitution ? (
                <span className="chip chip-brand">{patient.constitution}</span>
              ) : (
                <p className="text-[13px] text-ink-4">未辨识（可在基本信息里手动选择）</p>
              )}
            </section>

            <section className="card p-4">
              <h3 className="text-[12px] text-ink-3 mb-2 tracking-wide">档案</h3>
              <dl className="space-y-1.5 text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-4">建档</dt>
                  <dd className="text-ink-2 num">{formatDate(patient.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-4">最近更新</dt>
                  <dd className="text-ink-2 num">{formatDate(patient.updatedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-4">就诊次数</dt>
                  <dd className="text-ink-2 num">{timeline.length}</dd>
                </div>
              </dl>
            </section>

            <p className="text-[11.5px] text-ink-4 leading-relaxed px-1">
              病历一经提交不可修改，只可新增修订版；历史版本永远可追溯。
            </p>
          </aside>
        </div>
      </div>
    </>
  );
}
