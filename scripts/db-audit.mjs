import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const rows = await p.auditLog.findMany({
  orderBy: { createdAt: "asc" },
  select: { createdAt: true, action: true, entityType: true, entityId: true },
});
console.log("audit rows:", rows.length);
for (const r of rows) console.log(String(r.createdAt), r.action, r.entityType, r.entityId ?? "");
await p.$disconnect();
