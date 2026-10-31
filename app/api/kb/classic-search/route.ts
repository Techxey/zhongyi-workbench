import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { searchClassicText } from "@/lib/kb-classic";

export const dynamic = "force-dynamic";

/** 古籍正文检索（/kb 古籍页签的「搜正文」开关用）：全 701 部、全文覆盖，走 classic_fts */
export async function GET(request: Request) {
  const user = await getSession();
  if (!user) return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  const rawLimit = Number(url.searchParams.get("limit") ?? "60");
  const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 60, 1), 120);

  if (!query) return NextResponse.json({ ok: true, hits: [] });

  try {
    const hits = await searchClassicText(query, limit);
    return NextResponse.json({ ok: true, query, hits });
  } catch (error) {
    console.error("[classic-search]", error);
    return NextResponse.json({ ok: false, message: "正文检索失败，请重试" }, { status: 500 });
  }
}
