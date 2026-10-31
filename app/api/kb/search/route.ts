import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { searchKb } from "@/lib/kb-search";

export const dynamic = "force-dynamic";

const MAX_QUERY = 40;

export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = (url.searchParams.get("q") ?? "").slice(0, MAX_QUERY);
  const symptoms = (url.searchParams.get("symptoms") ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
  const syndrome = url.searchParams.get("syndrome") ?? "";

  try {
    const result = await searchKb(query, { symptoms, syndrome });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[kb/search]", error);
    return NextResponse.json({ ok: false, message: "检索失败，请重试" }, { status: 500 });
  }
}
