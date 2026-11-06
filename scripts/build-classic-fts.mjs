import { PrismaClient } from "@prisma/client";
import { statSync } from "node:fs";
import path from "node:path";

/**
 * 建古籍全文索引（FTS5）。
 * 用法：node scripts/build-classic-fts.mjs [--rebuild]
 * 幂等：已建过就跳过；--rebuild 会先清空再重建。
 */

const prisma = new PrismaClient();
const rebuild = process.argv.includes("--rebuild");
const started = Date.now();

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/g;

function spaced(text) {
  const padded = text.replace(CJK, (ch) => ` ${ch} `);
  return padded.replace(/\s+/g, " ").trim();
}

function splitChapters(rawJson, fallbackText) {
  const chapters = [];
  try {
    const parsed = JSON.parse(rawJson);
    const list = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    for (const chapter of list) {
      const body = String(chapter?.text ?? "").trim();
      if (!body) continue;
      chapters.push({ title: String(chapter?.title ?? "").trim() || null, body });
    }
    if (chapters.length === 0) {
      const text = String(parsed.text ?? fallbackText ?? "").trim();
      if (text) chapters.push({ title: null, body: text });
    }
  } catch {
    const text = String(fallbackText ?? "").trim();
    if (text) chapters.push({ title: null, body: text });
  }
  return chapters;
}

async function main() {
  await prisma.$executeRawUnsafe("PRAGMA synchronous=OFF");
  await prisma.$executeRawUnsafe("PRAGMA cache_size=-200000");
  await prisma.$executeRawUnsafe("PRAGMA temp_store=MEMORY");

  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "classic_chunks" (
      "rowid" INTEGER PRIMARY KEY AUTOINCREMENT,
      "item_id" TEXT NOT NULL,
      "chapter_no" INTEGER NOT NULL,
      "chapter_title" TEXT,
      "body" TEXT NOT NULL
    )`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_classic_chunks_item" ON "classic_chunks"("item_id")`);
  await prisma.$executeRawUnsafe(`
    CREATE VIRTUAL TABLE IF NOT EXISTS "classic_fts" USING fts5(
      body,
      content='',
      tokenize='unicode61 remove_diacritics 0'
    )`);

  const existing = await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM classic_chunks`);
  const chunkCount = Number(existing[0]?.n ?? 0);

  if (rebuild && chunkCount > 0) {
    console.log(`清空旧索引（${chunkCount} 块）…`);
    await prisma.$executeRawUnsafe(`DELETE FROM classic_chunks`);
    await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS classic_fts`);
    await prisma.$executeRawUnsafe(`
      CREATE VIRTUAL TABLE "classic_fts" USING fts5(
        body,
        content='',
        tokenize='unicode61 remove_diacritics 0'
      )`);
  }

  const books = await prisma.$queryRawUnsafe(`
    SELECT i.id AS id, i.name AS name, i.source AS source, b.raw_json AS rawJson
    FROM kb_items i
    JOIN kb_item_versions v ON v.kb_item_id = i.id AND v.version = i.current_version
    JOIN kb_item_bodies b ON b.version_id = v.id
    WHERE i.type = 'classic'
    ORDER BY i.name ASC`);

  // 默认增量：已经建过块的书跳过，只补新导入的书
  const indexed = new Set();
  if (!rebuild && chunkCount > 0) {
    const rows = await prisma.$queryRawUnsafe(`SELECT DISTINCT item_id AS id FROM classic_chunks`);
    for (const row of rows) indexed.add(row.id);
  }
  const pending = books.filter((book) => !indexed.has(book.id));

  const maxRow = await prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(rowid), 0) AS n FROM classic_chunks`);
  let nextRowid = Number(maxRow[0]?.n ?? 0) + 1;

  console.log(
    `古籍 ${books.length} 部，已索引 ${indexed.size} 部，本次待建 ${pending.length} 部，开始建索引…`,
  );
  if (pending.length === 0) {
    console.log(`全部已索引（${chunkCount} 块），无需重建（要整表重建请加 --rebuild）`);
    return;
  }
  let totalChunks = 0;
  let totalChars = 0;
  let done = 0;

  for (const book of pending) {
    const chapters = splitChapters(book.rawJson, "");
    if (chapters.length === 0) continue;

    const statements = [];
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index];
      const rowid = nextRowid++;

      statements.push(
        prisma.$executeRawUnsafe(
          `INSERT INTO classic_chunks(rowid, item_id, chapter_no, chapter_title, body) VALUES (?, ?, ?, ?, ?)`,
          rowid,
          book.id,
          index + 1,
          chapter.title,
          chapter.body,
        ),
      );
      statements.push(
        prisma.$executeRawUnsafe(`INSERT INTO classic_fts(rowid, body) VALUES (?, ?)`, rowid, spaced(chapter.body)),
      );
      totalChars += chapter.body.length;
    }

    await prisma.$transaction(statements);
    totalChunks += chapters.length;
    done += 1;

    if (done % 20 === 0 || done === books.length) {
      const elapsed = ((Date.now() - started) / 1000).toFixed(1);
      console.log(
        `  ${done}/${books.length} 部 · ${totalChunks} 块 · ${(totalChars / 1e6).toFixed(1)} 百万字 · ${elapsed}s`,
      );
    }
  }

  const dbSize = statSync(path.join(process.cwd(), "prisma", "dev.db")).size;
  console.log(
    `完成：${totalChunks} 块 / ${totalChars} 字，用时 ${((Date.now() - started) / 1000).toFixed(1)}s，库大小 ${(
      dbSize / 1024 / 1024
    ).toFixed(0)}MB`,
  );
}

main()
  .catch((error) => {
    console.error("建索引失败：", error?.message ?? error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
