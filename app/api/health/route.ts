import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    const [patients, visits, kbItems] = await Promise.all([
      prisma.patient.count(),
      prisma.visit.count(),
      prisma.kbItem.count(),
    ]);
    return NextResponse.json(
      { ok: true, db: true, counts: { patients, visits, kbItems } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, db: false, message: (error as Error).message.split("\n")[0] },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
