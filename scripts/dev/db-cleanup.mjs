import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// 演示库只留：张淑芬（无就诊）+ 陈素梅（第 1 次就诊已签名）。
// 多余的草稿就诊（空的「第 2 次接诊」）删掉，让「开始接诊」从干净状态进来。
const keepVisitIds = new Set(["b26cb79e-accf-4cfc-b79f-20a79b6773b2"]);

const drafts = await prisma.visit.findMany({
  where: { id: { notIn: [...keepVisitIds] } },
  select: { id: true, patientId: true, visitNo: true, status: true },
});
for (const visit of drafts) {
  const revisionIds = (
    await prisma.visitRevision.findMany({ where: { visitId: visit.id }, select: { id: true } })
  ).map((row) => row.id);
  const prescriptionIds = (
    await prisma.prescription.findMany({
      where: { visitRevisionId: { in: revisionIds } },
      select: { id: true },
    })
  ).map((row) => row.id);
  await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: { in: prescriptionIds } } });
  await prisma.prescription.deleteMany({ where: { id: { in: prescriptionIds } } });
  await prisma.visitRevision.deleteMany({ where: { visitId: visit.id } });
  await prisma.visit.delete({ where: { id: visit.id } });
  console.log("deleted visit", visit.visitNo, visit.status, visit.id);
}

console.log(
  "remaining:",
  JSON.stringify({
    patients: await prisma.patient.count(),
    visits: await prisma.visit.count(),
  }),
);
await prisma.$disconnect();
