import type { Metadata } from "next";
import Link from "next/link";

import { VocabManager } from "@/components/vocab-manager";
import { TopBar } from "@/components/topbar";
import { requireUser } from "@/lib/auth";
import { groupVocab } from "@/lib/vocabulary";
import { loadVocabItems } from "@/lib/vocabulary-server";

export const metadata: Metadata = {
  title: "接诊词库 · 中医诊疗工作台",
};

export const dynamic = "force-dynamic";

export default async function VocabularySettingsPage() {
  await requireUser();
  const items = await loadVocabItems();
  const grouped = groupVocab(items);

  return (
    <>
      <TopBar
        title={
          <span className="flex items-baseline gap-3">
            <Link href="/settings" className="text-[12.5px] text-ink-3 hover:text-brand font-normal">
              设置
            </Link>
            <span className="text-ink-4 font-normal">/</span>
            <span>接诊词库</span>
          </span>
        }
        subtitle="自己加词、自己删词，保存后全站可用"
        actions={
          <Link href="/settings" className="btn btn-ghost">
            返回设置
          </Link>
        }
      />
      <div className="px-[26px] py-6 max-w-[880px]">
        <p className="text-[12.5px] text-ink-3 leading-relaxed mb-5">
          舌象、脉象、证型、治法四类词条都保存在本机数据库：在这里或接诊台的「＋ 自定义」里新增，
          所有患者的接诊台立刻可用；删除同样全站生效。左侧数字是医生实际使用次数，用得多的会排在前面。
        </p>
        <VocabManager initial={grouped} />
      </div>
    </>
  );
}
