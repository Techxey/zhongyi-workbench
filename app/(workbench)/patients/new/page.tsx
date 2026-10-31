import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { TopBar } from "@/components/topbar";
import { NewPatientForm } from "./new-patient-form";

export const metadata: Metadata = {
  title: "新建患者 · 中医诊疗工作台",
};

export default async function NewPatientPage() {
  await requireUser();

  return (
    <>
      <TopBar
        title={
          <span className="flex items-baseline gap-3">
            <Link href="/patients" className="text-[12.5px] text-ink-3 hover:text-brand font-normal">
              患者
            </Link>
            <span className="text-ink-4 font-normal">/</span>
            <span className="text-[17px]">新建患者</span>
          </span>
        }
        actions={
          <Link href="/patients" className="btn btn-ghost">
            返回列表
          </Link>
        }
      />
      <div className="px-[26px] py-6 max-w-[880px]">
        <NewPatientForm />
      </div>
    </>
  );
}
