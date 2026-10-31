import { promises as fs } from "node:fs";
import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { BACKUP_DIR, isBackupName } from "@/lib/backup";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getSession();
  if (!session) return new NextResponse("未登录", { status: 401 });

  const { name } = await params;
  if (!isBackupName(name)) return new NextResponse("文件名不合法", { status: 400 });

  const file = await fs.readFile(`${BACKUP_DIR}\\${name}`).catch(() => null);
  if (!file) return new NextResponse("备份不存在", { status: 404 });

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
