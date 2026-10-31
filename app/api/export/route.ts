import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { buildFullExport } from "@/lib/backup";

export const dynamic = "force-dynamic";

/** 全量数据导出：医生自己留底、换机器、交给别人接手都能用 */
export async function GET() {
  const session = await getSession();
  if (!session) return new NextResponse("未登录", { status: 401 });

  const payload = await buildFullExport();
  const stamp = payload.generatedAt.slice(0, 19).replaceAll(":", "").replace("T", "-");
  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="zhongyi-export-${stamp}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
