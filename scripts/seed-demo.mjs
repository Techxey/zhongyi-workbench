import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const now = new Date();
const iso = (date) => date.toISOString();

// 把演示数据重建成固定状态：两位患者，其中陈素梅已有一次已签名就诊（归脾汤）。
// 只清业务数据，不动账号/设置/知识库。
const visitIds = (await prisma.visit.findMany({ select: { id: true } })).map((row) => row.id);
const revisionIds = (
  await prisma.visitRevision.findMany({ where: { visitId: { in: visitIds } }, select: { id: true } })
).map((row) => row.id);
const prescriptionIds = (
  await prisma.prescription.findMany({
    where: { visitRevisionId: { in: revisionIds } },
    select: { id: true },
  })
).map((row) => row.id);
await prisma.prescriptionItem.deleteMany({ where: { prescriptionId: { in: prescriptionIds } } });
await prisma.prescription.deleteMany({ where: { id: { in: prescriptionIds } } });
await prisma.visitRevision.deleteMany({ where: { visitId: { in: visitIds } } });
await prisma.visit.deleteMany({ where: { id: { in: visitIds } } });
await prisma.patient.deleteMany({});

const doctor = await prisma.user.findFirstOrThrow({ where: { username: "doctor" } });

const zhang = await prisma.patient.create({
  data: {
    name: "张淑芬",
    gender: "female",
    birthYear: 1984,
    phone: "13812346621",
    constitution: "气虚质",
    allergy: "青霉素过敏",
    pastHistory: "高血压 5 年，服氨氯地平 5mg qd；2021 年阑尾切除术后。",
    note: "首诊由家属陪同，听力略弱。",
    createdAt: iso(now),
    updatedAt: iso(now),
  },
});

const chen = await prisma.patient.create({
  data: {
    name: "陈素梅",
    gender: "female",
    birthYear: 1979,
    phone: "13600008888",
    constitution: "气虚质",
    allergy: "否认药物过敏",
    pastHistory: "甲状腺功能减退 3 年，服左甲状腺素钠片 50μg qd。",
    createdAt: iso(now),
    updatedAt: iso(now),
  },
});

const visitAt = new Date(now.getTime() - 60 * 60 * 1000);
const visit = await prisma.visit.create({
  data: {
    patientId: chen.id,
    visitNo: 1,
    visitAt: iso(visitAt),
    status: "draft",
    createdAt: iso(visitAt),
  },
});

const revision = await prisma.visitRevision.create({
  data: {
    visitId: visit.id,
    revisionNo: 1,
    parentRevisionId: null,
    chiefComplaint: "入睡困难 3 月余，加重 2 周",
    presentIllness:
      "近 3 月反复失眠，入睡需 1-2 小时，夜间易醒 2-3 次，伴心悸、多梦、醒后乏力；近 2 周工作压力增大后加重，白天注意力下降。",
    symptomsJson: JSON.stringify(["入睡困难", "多梦", "易醒", "心悸", "乏力"]),
    tongueJson: JSON.stringify(["舌淡红", "苔薄白"]),
    pulseJson: JSON.stringify(["脉细"]),
    syndrome: "心脾两虚",
    treatment: "益气补血，健脾养心",
    advice: "少思虑，忌浓茶咖啡；睡前热水泡脚。",
    followupDays: 7,
    remindFollowup: true,
    operatorId: doctor.id,
    createdAt: iso(visitAt),
  },
});

const kbItem = await prisma.kbItem.findFirst({
  where: { type: "formula", name: "归脾汤" },
  include: { versions: { orderBy: { version: "desc" }, take: 1 } },
});
const kbVersion = kbItem?.versions[0];

const herbs = [
  ["黄芪", "30", 30],
  ["党参", "15", 15],
  ["白术", "15", 15],
  ["茯神", "15", 15],
  ["当归", "12", 12],
  ["远志", "6", 6],
  ["酸枣仁", "20", 20],
  ["龙眼肉", "12", 12],
  ["木香", "6", 6],
  ["炙甘草", "6", 6],
];

const prescription = await prisma.prescription.create({
  data: {
    visitRevisionId: revision.id,
    formulaName: "归脾汤",
    formulaSource: kbItem?.source ?? "《正体类要》",
    kbItemId: kbItem?.id ?? null,
    kbItemVersion: kbVersion?.version ?? null,
    doses: 7,
    usageText: "每日 1 剂，水煎 400ml，分早晚温服",
    snapshotJson: JSON.stringify({
      formulaName: "归脾汤",
      source: kbItem?.source ?? "《正体类要》",
      items: herbs.map(([name, dose]) => ({ name, dose: `${dose}g` })),
      capturedAt: iso(visitAt),
    }),
    createdAt: iso(visitAt),
  },
});

await prisma.prescriptionItem.createMany({
  data: herbs.map(([name, dose, value], index) => ({
    prescriptionId: prescription.id,
    herbName: name,
    dose: `${dose}g`,
    doseValue: value,
    doseUnit: "g",
    role: "main",
    sortNo: index + 1,
    note: null,
  })),
});

await prisma.visit.update({
  where: { id: visit.id },
  data: { status: "signed", currentRevisionId: revision.id },
});

await prisma.auditLog.createMany({
  data: [
    {
      action: "create",
      entityType: "patient",
      entityId: zhang.id,
      afterJson: JSON.stringify({ name: "张淑芬" }),
      operatorId: doctor.id,
      createdAt: iso(now),
    },
    {
      action: "create",
      entityType: "patient",
      entityId: chen.id,
      afterJson: JSON.stringify({ name: "陈素梅" }),
      operatorId: doctor.id,
      createdAt: iso(now),
    },
    {
      action: "sign",
      entityType: "visit_revision",
      entityId: revision.id,
      beforeJson: null,
      afterJson: JSON.stringify({ visitId: visit.id, revisionNo: 1 }),
      operatorId: doctor.id,
      createdAt: iso(visitAt),
    },
  ],
});

console.log(
  JSON.stringify({
    patients: await prisma.patient.count(),
    visits: await prisma.visit.count(),
    chenId: chen.id,
    visitId: visit.id,
  }),
);
await prisma.$disconnect();
