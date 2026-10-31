import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();
const now = () => new Date().toISOString();

const SYMPTOM_TERMS = [
  "入睡困难", "多梦", "易醒", "心悸", "口干", "口苦", "乏力", "纳差",
  "腹胀", "便溏", "便秘", "尿频", "畏寒", "手足心热", "自汗", "盗汗",
  "头晕", "头痛", "耳鸣", "咳嗽", "咽干", "咽痛", "痰多", "胸闷",
  "气短", "腰膝酸软", "月经不调", "痛经", "经量少", "性急易怒", "情绪低落", "食欲亢进",
];

// 十八反（按「诸参辛芍叛藜芦」等歌诀拆到具体药对）
const EIGHTEEN_ANTAGONISMS = [
  ["甘草", "甘遂"], ["甘草", "大戟"], ["甘草", "海藻"], ["甘草", "芫花"],
  ["乌头", "贝母"], ["乌头", "瓜蒌"], ["乌头", "半夏"], ["乌头", "白蔹"], ["乌头", "白及"],
  ["藜芦", "人参"], ["藜芦", "沙参"], ["藜芦", "丹参"], ["藜芦", "玄参"], ["藜芦", "细辛"], ["藜芦", "芍药"],
];

// 十九畏
const NINETEEN_FEARS = [
  ["硫黄", "朴硝"], ["水银", "砒霜"], ["狼毒", "密陀僧"], ["巴豆", "牵牛子"],
  ["丁香", "郁金"], ["川乌", "犀角"], ["草乌", "犀角"], ["牙硝", "三棱"],
  ["官桂", "赤石脂"], ["人参", "五灵脂"],
];

async function main() {
  // 1. 种子账号
  const passwordHash = await bcrypt.hash("doctor1234", 10);
  await prisma.user.upsert({
    where: { username: "doctor" },
    update: {},
    create: {
      username: "doctor",
      passwordHash,
      displayName: "李医生",
      role: "doctor",
      createdAt: now(),
    },
  });

  // 2. 默认设置
  for (const [key, value] of [
    ["backup_retention_days", "30"],
    ["schema_version", "r1"],
  ]) {
    await prisma.setting.upsert({
      where: { key },
      update: {},
      create: { key, value, updatedAt: now() },
    });
  }

  // 3. 问诊要点词表（标签按使用频次排序，初始都给 1，实际使用会累加）
  for (const term of SYMPTOM_TERMS) {
    await prisma.symptomTerm.upsert({
      where: { normTerm: term },
      update: {},
      create: { term, normTerm: term, useCount: 1, createdAt: now() },
    });
  }

  // 4. 配伍禁忌（只提示，不拦截处方）
  const existing = await prisma.herbIncompatibility.count();
  if (existing === 0) {
    await prisma.herbIncompatibility.createMany({
      data: [
        ...EIGHTEEN_ANTAGONISMS.map(([a, b]) => ({ herbA: a, herbB: b, rule: "十八反" })),
        ...NINETEEN_FEARS.map(([a, b]) => ({ herbA: a, herbB: b, rule: "十九畏" })),
      ],
    });
  }

  const counts = {
    users: await prisma.user.count(),
    settings: await prisma.setting.count(),
    symptomTerms: await prisma.symptomTerm.count(),
    incompatibilities: await prisma.herbIncompatibility.count(),
  };
  console.log("seed done:", counts);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
