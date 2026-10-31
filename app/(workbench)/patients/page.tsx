import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { TopBar } from "@/components/topbar";
import { PatientDirectory, type DirectoryPatient } from "./directory";

export const dynamic = "force-dynamic";

export default async function PatientsPage() {
  await requireUser();

  const rows = await prisma.patient.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      visits: {
        select: { id: true, visitAt: true },
        orderBy: { visitAt: "desc" },
      },
    },
  });

  const patients: DirectoryPatient[] = rows.map((p) => ({
    id: p.id,
    name: p.name,
    gender: p.gender,
    birthYear: p.birthYear,
    phone: p.phone,
    constitution: p.constitution,
    allergy: p.allergy,
    visitCount: p.visits.length,
    lastVisitAt: p.visits[0]?.visitAt ?? null,
  }));

  return (
    <>
      <TopBar
        title="患者"
        subtitle={patients.length > 0 ? `共 ${patients.length} 位` : undefined}
        actions={
          <Link href="/patients/new" className="btn btn-primary">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            新建患者
          </Link>
        }
      />
      <div className="px-[26px] py-6">
        <PatientDirectory patients={patients} />
      </div>
    </>
  );
}
