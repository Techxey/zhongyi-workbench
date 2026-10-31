import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { IMPORT_TEMPLATE_HEAD, IMPORT_TEMPLATE_SAMPLE } from "@/lib/kb";
import { toCsvLine } from "@/lib/kb-import";

export const dynamic = "force-dynamic";

/** 模板下载：CSV 带 BOM，Excel 双击打开中文不乱码 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ ok: false, message: "未登录" }, { status: 401 });
  }

  const body = `\uFEFF${toCsvLine(IMPORT_TEMPLATE_HEAD)}\r\n${toCsvLine(IMPORT_TEMPLATE_SAMPLE)}\r\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="kb-template.csv"',
      "Cache-Control": "no-store",
    },
  });
}
