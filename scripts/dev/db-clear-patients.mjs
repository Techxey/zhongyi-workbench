import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const r = await p.patient.deleteMany({});
console.log("deleted patients:", r.count);
console.log("remaining:", await p.patient.count());
await p.$disconnect();
