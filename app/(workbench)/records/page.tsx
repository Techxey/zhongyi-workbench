import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TopBar } from "@/components/topbar";
import { ageOf, formatDate, genderLabel } from "@/lib/format";

export const dynamic = "force-dynamic";

function maskInSnippet(text: string, query: string, radius = 26): string {
  const index = text.indexOf(query);
  if (index < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + query.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

type MatchField = { label: string; text: string };

export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireUser();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const results = query
    ? await prisma.visit.findMany({
        where: {
          status: "signed",
          revisions: {
            some: {
              OR: [
                { chiefComplaint: { contains: query } },
                { presentIllness: { contains: query } },
                { syndrome: { contains: query } },
                { treatment: { contains: query } },
                { advice: { contains: query } },
              ],
            },
          },
        },
        include: {
          patient: true,
          revisions: {
            orderBy: { revisionNo: "desc" },
            take: 1,
            include: { prescriptions: { include: { items: { orderBy: { sortNo: "asc" } } } } },
          },
        },
        orderBy: { visitAt: "desc" },
        take: 50,
      })
    : [];

  const rxOnly = query
    ? await prisma.prescription.findMany({
        where: {
          OR: [
            { formulaName: { contains: query } },
            { items: { some: { herbName: { contains: query } } } },
          ],
          revision: { visit: { status: "signed" } },
        },
        include: {
          items: { orderBy: { sortNo: "asc" } },
          revision: { include: { visit: { include: { patient: true } } } },
        },
        orderBy: { createdAt: "desc" },
        take: 30,
      })
    : [];

  const seenVisits = new Set(results.map((visit) => visit.id));
  const rxHits = rxOnly.filter((rx) => {
    const visitId = rx.revision.visit.id;
    if (seenVisits.has(visitId)) return false;
    // 同一次就诊可能有多个版本都命中，只保留最新那一版的处方
    seenVisits.add(visitId);
    return true;
  });

  return (
    <div className="min-h-screen bg-canvas pb-16">
      <TopBar
        title="整本病历"
        subtitle="按主诉、现病史、证型、治法、医嘱、方名、药名搜，跨所有患者"
        actions={
          <>
            <Link href="/visits" className="btn btn-quiet">
              回到接诊
            </Link>
            <Link href="/patients" className="btn btn-ghost">
              患者列表
            </Link>
          </>
        }
      />

      <div className="px-[26px] pt-4 max-w-[980px]">
        <form method="get" className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={query}
            autoFocus
            placeholder="搜症状、证型、治法或方名，例如「失眠」「归脾汤」「黄芪」"
            className="input h-11 flex-1 bg-surface"
            aria-label="检索病历"
          />
          <button type="submit" className="btn btn-primary h-11 px-5">
            搜索
          </button>
        </form>

        {query ? (
          <p className="mt-3 text-[12.5px] text-ink-3">
            找到 <span className="text-ink num">{results.length + rxHits.length}</span> 条与「
            {query}」相关的病历
          </p>
        ) : (
          <p className="mt-3 text-[12.5px] text-ink-3">
            输入关键词开始搜索。搜的是已签名的正式病历；草稿不会出现在这里。
          </p>
        )}

        <ul className="mt-3 space-y-[10px]">
          {results.map((visit) => {
            const revision = visit.revisions[0];
            const rx = revision?.prescriptions[0] ?? null;
            const sources: MatchField[] = [
              { label: "主诉", text: revision?.chiefComplaint ?? "" },
              { label: "现病史", text: revision?.presentIllness ?? "" },
              { label: "证型", text: revision?.syndrome ?? "" },
              { label: "治法", text: revision?.treatment ?? "" },
              { label: "医嘱", text: revision?.advice ?? "" },
            ];
            const hit = sources.find((source) => source.text.includes(query));
            return (
              <li key={visit.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/patients/${visit.patientId}`}
                      className="text-[14px] text-ink hover:text-brand"
                    >
                      {visit.patient.name}
                    </Link>
                    <span className="text-[12px] text-ink-3">
                      {genderLabel(visit.patient.gender)}
                      {visit.patient.birthYear ? ` · ${ageOf(visit.patient.birthYear)}` : ""}
                    </span>
                    <span className="text-[12px] text-ink-4 num">
                      {formatDate(visit.visitAt)} · 第 {visit.visitNo} 次
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {rx?.formulaName ? (
                      <span className="chip chip-brand">{rx.formulaName}</span>
                    ) : null}
                    <Link href={`/visits/${visit.id}`} className="btn btn-quiet h-7 px-2.5 text-[12px]">
                      打开病历
                    </Link>
                  </div>
                </div>
                {hit ? (
                  <p className="mt-2 text-[12.5px] text-ink-2">
                    <span className="text-ink-4">{hit.label}：</span>
                    {maskInSnippet(hit.text, query)}
                  </p>
                ) : null}
                {rx?.items.length ? (
                  <p className="mt-1 text-[12px] text-ink-3 truncate">
                    {rx.items.map((item) => `${item.herbName}${item.dose ?? ""}`).join(" ")}
                  </p>
                ) : null}
              </li>
            );
          })}

          {rxHits.map((rx) => {
            const visit = rx.revision.visit;
            return (
              <li key={rx.id} className="card p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="flex items-baseline gap-2">
                    <Link
                      href={`/patients/${visit.patientId}`}
                      className="text-[14px] text-ink hover:text-brand"
                    >
                      {visit.patient.name}
                    </Link>
                    <span className="text-[12px] text-ink-3">
                      {genderLabel(visit.patient.gender)}
                      {visit.patient.birthYear ? ` · ${ageOf(visit.patient.birthYear)}` : ""}
                    </span>
                    <span className="text-[12px] text-ink-4 num">
                      {formatDate(visit.visitAt)} · 第 {visit.visitNo} 次
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="chip chip-brand">{rx.formulaName ?? "处方"}</span>
                    <Link href={`/visits/${visit.id}`} className="btn btn-quiet h-7 px-2.5 text-[12px]">
                      打开病历
                    </Link>
                  </div>
                </div>
                <p className="mt-2 text-[12.5px] text-ink-2">
                  <span className="text-ink-4">命中处方：</span>
                  {rx.items.map((item) => `${item.herbName}${item.dose ?? ""}`).join(" ")}
                </p>
              </li>
            );
          })}
        </ul>

        {query && results.length + rxHits.length === 0 ? (
          <div className="card mt-3 p-8 text-center">
            <p className="text-[13.5px] text-ink-2 mb-1">没有找到与「{query}」相关的病历</p>
            <p className="text-[12.5px] text-ink-3">
              换一个词试试，比如只搜证型（心脾两虚）或方名（归脾汤）。
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
