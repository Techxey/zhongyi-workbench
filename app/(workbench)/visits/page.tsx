import type { Metadata } from "next";
import Link from "next/link";

import { TopBar } from "@/components/topbar";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { ageOf, genderLabel } from "@/lib/format";
import { KbSearchTrigger } from "@/components/kb-search-overlay";

export const metadata: Metadata = {
  title: "接诊 · 中医诊疗工作台",
};

export const dynamic = "force-dynamic";

function isToday(iso: string): boolean {
  const date = new Date(iso);
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function timeOf(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / 86_400_000);
}

function formatDay(date: Date): string {
  return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
}

export default async function ClinicPage() {
  await requireUser();

  const visits = await prisma.visit.findMany({
    orderBy: { visitAt: "desc" },
    take: 60,
    include: {
      patient: true,
      revisions: { orderBy: { revisionNo: "desc" }, take: 1 },
    },
  });

  const drafts = visits.filter((visit) => visit.status === "draft");
  const today = visits.filter((visit) => visit.status !== "draft" && isToday(visit.visitAt));
  const recent = visits.filter((visit) => visit.status !== "draft" && !isToday(visit.visitAt)).slice(0, 8);

  // 待复诊：医生写病历时填的「X 天后复诊」，只算勾了「就诊时提醒」的；
  // 每位患者只看最近一次已签病历（他后来又来了，旧的那次就算已复诊）
  const now = new Date();
  const latestByPatient = new Map<string, (typeof visits)[number]>();
  for (const visit of visits) {
    if (visit.status === "draft") continue;
    if (!latestByPatient.has(visit.patientId)) latestByPatient.set(visit.patientId, visit);
  }
  const followups = [...latestByPatient.values()]
    .map((visit) => {
      const revision = visit.revisions[0];
      if (!revision || revision.followupDays === null || revision.remindFollowup === false) return null;
      const due = new Date(visit.visitAt);
      due.setDate(due.getDate() + revision.followupDays);
      const offset = daysBetween(now, due);
      if (offset > 3) return null;
      return { visit, revision, due, offset };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row))
    .sort((a, b) => a.due.getTime() - b.due.getTime());
  const dueCount = followups.filter((row) => row.offset <= 0).length;

  return (
    <>
      <TopBar
        title="接诊"
        subtitle="今天要看的病人、没写完的病历，都在这"
        actions={
          <>
            <KbSearchTrigger />
            <Link href="/records" className="btn btn-quiet">
              整本病历
            </Link>
            <Link href="/patients/new" className="btn btn-ghost">
              ＋ 新建患者
            </Link>
            <Link href="/patients" className="btn btn-primary">
              从患者列表开始
            </Link>
          </>
        }
      />

      <div className="px-[26px] py-6 space-y-5 max-w-[1080px]">
        {drafts.length > 0 ? (
          <section className="card">
            <div className="px-5 h-[50px] flex items-center justify-between border-b border-line-2">
              <h2 className="section-title">没写完的病历</h2>
              <span className="text-[11.5px] text-ink-4">{drafts.length} 份草稿，接着写不会丢</span>
            </div>
            <ul>
              {drafts.map((visit) => (
                <li key={visit.id} className="border-b border-line-2 last:border-b-0">
                  <Link
                    href={`/visits/${visit.id}`}
                    className="px-5 h-[58px] flex items-center gap-4 hover:bg-ghost transition-colors"
                  >
                    <span className="w-[64px] text-[12px] text-ink-4 num">第 {visit.visitNo} 次</span>
                    <span className="text-[14px] text-ink font-medium">{visit.patient.name}</span>
                    <span className="text-[12px] text-ink-3">
                      {genderLabel(visit.patient.gender)} · {ageOf(visit.patient.birthYear)}
                    </span>
                    <span className="ml-auto chip chip-accent">草稿</span>
                    <span className="text-[12px] text-brand">继续接诊 →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="card">
          <div className="px-5 h-[50px] flex items-center justify-between border-b border-line-2">
            <h2 className="section-title">今日接诊</h2>
            <span className="text-[11.5px] text-ink-4">{today.length} 人</span>
          </div>
          {today.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="text-[13.5px] text-ink-2 mb-1">今天还没有完成的接诊</p>
              <p className="text-[12.5px] text-ink-3 mb-4">
                到患者列表点「开始接诊」，或直接新建一位患者。
              </p>
              <Link href="/patients" className="btn btn-primary">
                去患者列表
              </Link>
            </div>
          ) : (
            <ul>
              {today.map((visit) => {
                const revision = visit.revisions[0];
                return (
                  <li key={visit.id} className="border-b border-line-2 last:border-b-0">
                    <Link
                      href={`/visits/${visit.id}`}
                      className="px-5 h-[58px] flex items-center gap-4 hover:bg-ghost transition-colors"
                    >
                      <span className="w-[46px] text-[12px] text-ink-4 num">{timeOf(visit.visitAt)}</span>
                      <span className="text-[14px] text-ink font-medium">{visit.patient.name}</span>
                      <span className="text-[12px] text-ink-3">
                        {genderLabel(visit.patient.gender)} · {ageOf(visit.patient.birthYear)}
                      </span>
                      <span className="text-[12px] text-ink-3">第 {visit.visitNo} 次</span>
                      {revision?.syndrome ? <span className="chip chip-brand">{revision.syndrome}</span> : null}
                      <span className="ml-auto text-[11.5px] text-ink-4">已签名 · 查看病历</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {followups.length > 0 ? (
          <section className="card">
            <div className="px-5 h-[50px] flex items-center justify-between border-b border-line-2">
              <h2 className="section-title">待复诊</h2>
              <span className="text-[11.5px] text-ink-4 num">
                {followups.length} 位该回诊
                {dueCount > 0 ? ` · ${dueCount} 位已到期` : ""}
              </span>
            </div>
            <ul>
              {followups.map(({ visit, revision, due, offset }) => (
                <li key={visit.id} className="border-b border-line-2 last:border-b-0">
                  <Link
                    href={`/patients/${visit.patientId}`}
                    className="px-5 h-[56px] flex items-center gap-4 hover:bg-ghost transition-colors"
                  >
                    <span className="w-[74px] text-[12px] text-ink-4 num">{formatDay(due)}</span>
                    <span className="text-[14px] text-ink font-medium">{visit.patient.name}</span>
                    <span className="text-[12px] text-ink-3">
                      {genderLabel(visit.patient.gender)} · {ageOf(visit.patient.birthYear)}
                    </span>
                    <span className="text-[12px] text-ink-3">第 {visit.visitNo} 次</span>
                    {revision.syndrome ? <span className="chip chip-brand">{revision.syndrome}</span> : null}
                    <span
                      className={`ml-auto text-[12px] num ${
                        offset < 0 ? "text-danger" : offset === 0 ? "text-brand" : "text-ink-4"
                      }`}
                    >
                      {offset < 0
                        ? `逾期 ${-offset} 天`
                        : offset === 0
                          ? "今天该复诊"
                          : `${offset} 天后`}
                    </span>
                    <span className="text-[11.5px] text-brand">去接诊 →</span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="px-5 py-2.5 text-[11.5px] text-ink-4 border-t border-line-2">
              按病历里填的「复诊 X 天后」推算；患者后来又来过的那次会自动从清单里去掉。
            </p>
          </section>
        ) : null}

        {recent.length > 0 ? (
          <section className="card">
            <div className="px-5 h-[50px] flex items-center justify-between border-b border-line-2">
              <h2 className="section-title">之前的接诊</h2>
              <span className="text-[11.5px] text-ink-4">最近 8 次</span>
            </div>
            <ul>
              {recent.map((visit) => (
                <li key={visit.id} className="border-b border-line-2 last:border-b-0">
                  <Link
                    href={`/visits/${visit.id}`}
                    className="px-5 h-[52px] flex items-center gap-4 hover:bg-ghost transition-colors"
                  >
                    <span className="w-[88px] text-[12px] text-ink-4 num">
                      {new Date(visit.visitAt).toISOString().slice(5, 10)}
                    </span>
                    <span className="text-[13.5px] text-ink">{visit.patient.name}</span>
                    <span className="text-[12px] text-ink-3">第 {visit.visitNo} 次</span>
                    <span className="ml-auto text-[11.5px] text-ink-4">查看</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
