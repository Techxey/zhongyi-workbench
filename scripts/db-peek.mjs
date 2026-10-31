import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const patients = await prisma.patient.findMany({
  select: { id: true, name: true, createdAt: true, _count: { select: { visits: true } } },
  orderBy: { createdAt: "asc" },
});
console.log(patients.map((p) => `${p.id} ${p.name} visits=${p._count.visits} ${p.createdAt}`).join("\n"));

const visits = await prisma.visit.findMany({
  select: { id: true, patientId: true, visitNo: true, status: true },
  orderBy: { visitAt: "asc" },
});
console.log(visits.map((v) => `${v.id} p=${v.patientId.slice(0, 8)} no=${v.visitNo} ${v.status}`).join("\n"));

await prisma.$disconnect();
