"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ageOf, formatDate, genderLabel, maskPhone, matchesQuery, truncate } from "@/lib/format";

export type DirectoryPatient = {
  id: string;
  name: string;
  cardNo: string | null;
  gender: string | null;
  birthYear: number | null;
  phone: string | null;
  constitution: string | null;
  allergy: string | null;
  visitCount: number;
  lastVisitAt: string | null;
};

export function PatientDirectory({ patients }: { patients: DirectoryPatient[] }) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(
    () =>
      patients.filter((p) =>
        matchesQuery({ name: p.name, phone: p.phone, cardNo: p.cardNo }, query),
      ),
    [patients, query],
  );

  if (patients.length === 0) {
    return (
      <div className="card px-6 py-16 flex flex-col items-center text-center">
        <div className="w-11 h-11 rounded-full bg-brand-soft grid place-items-center mb-4 text-brand">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="8.5" r="3.6" stroke="currentColor" strokeWidth="1.6" />
            <path
              d="M4.8 20c0-3.6 3.2-6.2 7.2-6.2s7.2 2.6 7.2 6.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </div>
        <p className="font-serif text-[16px] text-ink mb-1.5">还没有患者</p>
        <p className="text-[13px] text-ink-3 mb-5 max-w-[360px] leading-relaxed">
          新建第一位患者，之后的每次就诊都会记在同一个时间轴上。
        </p>
        <Link href="/patients/new" className="btn btn-primary">
          新建患者
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative w-[320px]">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4 pointer-events-none">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
              <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.7" />
              <path d="m16 16 4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </span>
          <input
            className="input pl-9"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="姓名 / 手机号后四位 / 卡号 / 拼音首字母"
            aria-label="搜索患者"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full text-ink-4 hover:bg-ghost hover:text-ink-2 grid place-items-center"
              aria-label="清除搜索"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="m6 6 12 12M18 6 6 18"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          ) : null}
        </div>
        {query ? (
          <span className="text-[12.5px] text-ink-3 num">
            找到 {filtered.length} 位
          </span>
        ) : null}
      </div>

      <div className="card overflow-hidden max-lg:overflow-x-auto">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse">
          <thead>
            <tr className="text-left text-[12px] text-ink-3">
              <th className="font-normal px-4 h-10 border-b border-line-2 w-[26%]">姓名</th>
              <th className="font-normal px-4 h-10 border-b border-line-2 w-[16%]">性别 · 年龄</th>
              <th className="font-normal px-4 h-10 border-b border-line-2 w-[16%]">体质</th>
              <th className="font-normal px-4 h-10 border-b border-line-2 w-[18%]">最近就诊</th>
              <th className="font-normal px-4 h-10 border-b border-line-2 w-[10%]">就诊次数</th>
              <th className="font-normal px-4 h-10 border-b border-line-2 w-[14%]">过敏史</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr key={p.id} className="group border-b border-line-2 last:border-b-0 hover:bg-ghost">
                <td className="px-4 py-0">
                  <Link href={`/patients/${p.id}`} className="flex flex-col justify-center h-[58px]">
                    <span className="text-[14px] text-ink group-hover:text-brand transition-colors">
                      {p.name}
                    </span>
                    <span className="text-[11.5px] text-ink-4 num mt-0.5">
                      {p.phone ? maskPhone(p.phone) : "未留手机号"}
                      {p.cardNo ? <span className="text-ink-4"> · 卡号 {p.cardNo}</span> : null}
                    </span>
                  </Link>
                </td>
                <td className="px-4 text-[13px] text-ink-2">
                  {genderLabel(p.gender)}
                  <span className="text-ink-3">
                    {" "}
                    · {p.birthYear ? ageOf(p.birthYear) : "年龄未填"}
                  </span>
                </td>
                <td className="px-4 text-[13px]">
                  {p.constitution ? (
                    <span className="chip chip-brand">{p.constitution}</span>
                  ) : (
                    <span className="text-ink-4">—</span>
                  )}
                </td>
                <td className="px-4 text-[13px] text-ink-2 num">
                  {p.lastVisitAt ? formatDate(p.lastVisitAt) : <span className="text-ink-4">未接诊</span>}
                </td>
                <td className="px-4 text-[13px] text-ink-2 num">{p.visitCount}</td>
                <td className="px-4 text-[13px]">
                  {p.allergy ? (
                    <span
                      className="chip chip-danger max-w-[150px] overflow-hidden text-ellipsis block"
                      title={p.allergy}
                    >
                      {truncate(p.allergy, 8)}
                    </span>
                  ) : (
                    <span className="text-[12.5px] text-ink-4">否认</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          </table>
        </div>

        {filtered.length === 0 ? (
          <div className="px-6 py-14 text-center">
            <p className="text-[13.5px] text-ink-2 mb-1">没有匹配「{query}」的患者</p>
            <p className="text-[12.5px] text-ink-3 mb-4">
              可试姓名、手机号后四位、门诊卡号，或拼音首字母（如 zsf）
            </p>
            <button type="button" className="btn btn-ghost" onClick={() => setQuery("")}>
              清除搜索
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
