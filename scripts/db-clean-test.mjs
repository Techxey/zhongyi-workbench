import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const res = await p.patient.deleteMany({ where: { name: "测试患者" } });
console.log("deleted", res.count);
await p.$disconnect();
