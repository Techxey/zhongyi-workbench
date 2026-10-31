import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const ps = await p.patient.findMany({
  select: { id: true, name: true, phone: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});
console.log("patients:", ps.length);
for (const x of ps) console.log(String(x.createdAt), x.name, x.phone, x.id);
console.log("visits:", await p.visit.count(), "revisions:", await p.visitRevision.count());
await p.$disconnect();
