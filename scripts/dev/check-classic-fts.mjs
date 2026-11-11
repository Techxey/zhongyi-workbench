import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

function ftsQuery(query) {
  const tokens = [];
  let latin = "";
  const flush = () => {
    if (latin) {
      tokens.push(latin);
      latin = "";
    }
  };
  for (const char of Array.from(query.trim())) {
    if (CJK.test(char)) {
      flush();
      tokens.push(char);
    } else if (/[0-9a-zA-Z]/.test(char)) {
      latin += char;
    } else {
      flush();
    }
  }
  flush();
  return `"${tokens.join(" ")}"`;
}

const sql = `
  SELECT c.item_id AS itemId, c.chapter_no AS chapterNo, c.chapter_title AS chapterTitle,
         i.name AS name, i.source AS source, c.body AS body
  FROM classic_fts
  JOIN classic_chunks c ON c.rowid = classic_fts.rowid
  JOIN kb_items i ON i.id = c.item_id
  WHERE classic_fts MATCH ?
    AND i.type = 'classic' AND i.status = 'active'
  LIMIT 400`;

async function run(label, needle) {
  const started = Date.now();
  const rows = await prisma.$queryRawUnsafe(sql, ftsQuery(needle));
  const cast = Date.now() - started;
  const books = new Set(rows.map((r) => r.itemId));
  const first = rows[0];
  console.log(
    `${label.padEnd(18)} ${String(cast).padStart(4)}ms  rows=${String(rows.length).padStart(3)} books=${String(books.size).padStart(3)}`,
  );
  if (first) {
    const body = String(first.body).replace(/\s+/g, " ");
    const index = body.indexOf(needle);
    const snippet = index >= 0 ? body.slice(Math.max(index - 12, 0), index + needle.length + 30) : body.slice(0, 60);
    console.log(`   →《${first.name}》${first.chapterTitle ?? ""} · ${snippet}`);
  }
  return rows.length;
}

// 大书尾部：取《医宗金鉴》最后一章中间的一段
const big = await prisma.$queryRawUnsafe(`
  SELECT i.name AS name, c.chapter_no AS n, c.body AS body
  FROM classic_chunks c JOIN kb_items i ON i.id = c.item_id
  WHERE i.name = '医宗金鉴'
  ORDER BY c.chapter_no DESC, c.rowid DESC LIMIT 1`);
const tailBody = String(big[0]?.body ?? "").replace(/\s+/g, " ");
const tailPhrase = tailBody.slice(Math.floor(tailBody.length / 2), Math.floor(tailBody.length / 2) + 8);
console.log(`大书：${big[0]?.name} 第 ${big[0]?.n} 章，尾部取样「${tailPhrase}」`);

await run("单字 瘀", "瘀");
await run("常用 失眠", "失眠");
await run("两字 黄芪", "黄芪");
await run("方名 归脾汤", "归脾汤");
await run("条文 太阳之为病", "太阳之为病");
await run("证型 心脾两虚", "心脾两虚");
await run("大书尾部短语", tailPhrase);

const rows = await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM classic_chunks`);
console.log("chunks", rows[0]?.n);

await prisma.$disconnect();
