import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const KEEP_PATIENTS = new Set([
  "9b814d78-5714-4f95-b6f8-e12ee33e1dad", // 张淑芬（R1 演示患者：过敏史/既往史）
  "f7e58f23-c395-4ad4-a21f-4ed4d1376cd0", // 陈素梅（R2 演示患者：第 1 次就诊已签名）
]);
const KEEP_VISITS = new Set(["2c2883de-1b03-46c3-8ef3-94385f874ebe"]);

const visits = await prisma.visit.findMany({ select: { id: true, patientId: true } });
for (const visit of visits) {
  if (KEEP_VISITS.has(visit.id) && KEEP_PATIENTS.has(visit.patientId)) continue;
  const revisionIds = (
    await prisma.visitRevision.findMany({ where: { visitId: visit.id }, select: { id: true } })
  ).map((row) => row.id);
  const prescriptions = await prisma.prescription.findMany({
    where: { visitRevisionId: { in: revisionIds } },
    select: { id: true },
  });
  const prescriptionIds = prescriptions.map((row) => row.id);
  await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: { in: prescriptionIds } } });
  await prisma.prescription.deleteMany({ where: { id: { in: prescriptionIds } } });
  await prisma.visitRevision.deleteMany({ where: { visitId: visit.id } });
  await prisma.visit.delete({ where: { id: visit.id } });
  console.log("deleted visit", visit.id);
}

const patients = await prisma.patient.findMany({ select: { id: true, name: true } });
for (const patient of patients) {
  if (KEEP_PATIENTS.has(patient.id)) continue;
  await prisma.visit.deleteMany({ where: { patientId: patient.id } });
  await prisma.patient.delete({ where: { id: patient.id } });
  console.log("deleted patient", patient.name, patient.id);
}

console.log(
  "remaining:",
  JSON.stringify({
    patients: await prisma.patient.count(),
    visits: await prisma.visit.count(),
    revisions: await prisma.visitRevision.count(),
    prescriptions: await prisma.prescription.count(),
  }),
);

await prisma.$disconnect();
