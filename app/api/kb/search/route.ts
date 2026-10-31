import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { getClassicBook } from "@/lib/kb-classic";
import { searchKb } from "@/lib/kb-search";

export const dynamic = "force-dynamic";

const MAX_QUERY = 40;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });
  }

  const url = new URL(request.url);

  // 古籍详情：?id=<itemId> 返回简介 + 章节（正文只在需要时取，不随检索返回）
  const itemId = url.searchParams.get("id");
  if (itemId) {
    try {
      const book = await getClassicBook(itemId);
      if (!book) return NextResponse.json({ ok: false, message: "未找到古籍" }, { status: 404 });
      return NextResponse.json({ ok: true, book });
    } catch (error) {
      console.error("[kb/search] classic detail", error);
      return NextResponse.json({ ok: false, message: "读取古籍失败" }, { status: 500 });
    }
  }

  const query = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY);
  const symptoms = (url.searchParams.get("symptoms") ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const syndrome = url.searchParams.get("syndrome") ?? "";
  const deep = url.searchParams.get("deep") === "1";

  try {
    const result = await searchKb(query, { symptoms, syndrome, deep });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[kb/search]", error);
    return NextResponse.json({ ok: false, message: "检索失败，请重试" }, { status: 500 });
  }
}
