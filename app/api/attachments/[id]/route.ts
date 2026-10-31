import { NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readUpload } from "@/lib/uploads";

export const dynamic = "force-dynamic";

/** 图片读取：必须登录，避免病历照片被直链拿走 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getSession();
  if (!user) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  const { id } = await context.params;
  const attachment = await prisma.attachment.findUnique({ where: { id } });
  if (!attachment) {
    return NextResponse.json({ error: "图片不存在" }, { status: 404 });
  }

  try {
    const bytes = await readUpload(attachment.storedPath);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Length": String(attachment.byteSize),
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "图片文件已丢失" }, { status: 404 });
  }
}
