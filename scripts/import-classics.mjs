/**
 * 把 TCM-Ancient-Books 的古籍 txt 导入「知识库」。
 *
 * 数据来源：https://github.com/xiaopangxia/TCM-Ancient-Books（约 700 部，GBK 编码）
 * 入库约定：
 *   kb_items.type = "classic"，name 去掉 `NNN-` 前缀与 `.txt`，source = 作者·朝代
 *   kb_item_versions.version = 1
 *   raw_json  = JSON.stringify({ text, chapters:[{title,text}], source, charCount, author, dynasty, intro })
 *   indication = 简介（正文前 200 字）
 *   commentary = JSON.stringify({ chars, chapters, author, dynasty })
 * 幂等：按 (type, name, source) 已存在则更新版本内容，不重复插入。
 *
 * 用法：node scripts/import-classics.mjs [--dir tmp/tcm-books-raw] [--limit N]
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

loadEnvFile();

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const argv = process.argv.slice(2);
const argValue = (flag, fallback) => {
  const index = argv.indexOf(flag);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const SOURCE_DIR = path.resolve(ROOT, argValue("--dir", "tmp/tcm-books-raw"));
const LIMIT = Number(argValue("--limit", "0")) || 0;
const BATCH_SOURCE = "TCM-Ancient-Books";
const INTRO_LIMIT = 200;

function loadEnvFile() {
  if (process.env.DATABASE_URL) return;
  try {
    const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[match[1]] === undefined) process.env[match[1]] = value;
    }
  } catch {
    // 没有 .env 就交给环境变量
  }
}

/** 源文件多为 GBK：先按 UTF-8 严格解，失败再按 GBK */
function decodeBuffer(buffer) {
  const bytes = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? buffer.subarray(3) : buffer;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("gbk").decode(bytes);
  }
}

function cleanText(raw) {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[\u00a0\u3000]/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractLine(text, label) {
  // 注意：[：:] 后只用 [ \t]*，不能用 \s*——\s 会跨过换行，
  // 把「作者：」空值后面下一行的「朝代：」当成作者（曾造成 source 变成「朝代：·年份：」）。
  const match = new RegExp(`^${label}[：:][ \\t]*(.+?)[ \\t]*$`, "m").exec(text);
  if (!match) return "";
  const value = match[1].trim();
  // 再兜底一次：值里不该再出现别的标签
  if (/^(书名|作者|朝代|年份)[：:]/.test(value)) return "";
  return value;
}

/** 从 `457-伤寒论.txt` / `700.李培生老中医经验集.txt` 得到书名 */
function nameFromFile(fileName) {
  const base = fileName.replace(/\.txt$/i, "");
  return base
    .replace(/^\s*\d+\s*[-_.、．]\s*/, "")
    .replace(/_/g, " ")
    .trim();
}

function splitBody(text) {
  // 头部：<篇名>书名 / 书名： / 作者： / 朝代： / 年份： / <目录>
  const lines = text.split("\n");
  let bodyStart = 0;
  let sawHeader = false;
  for (let index = 0; index < Math.min(lines.length, 40); index += 1) {
    const line = lines[index].trim();
    if (/^<(目录|目錄)>/.test(line) || /^<目录>/.test(line)) {
      bodyStart = index + 1;
      sawHeader = true;
      break;
    }
    if (/^(书名|作者|朝代|年份)[：:]/.test(line) || /^<篇名>/.test(line)) {
      sawHeader = true;
      bodyStart = index + 1;
    }
  }
  if (!sawHeader) bodyStart = 0;
  return lines.slice(bodyStart).join("\n");
}

/** 章节切分：优先 <篇名>，其次「卷/第X章」，切不出就整本一章 */
function splitChapters(body) {
  const chapters = [];
  const marker = /<篇名>\s*([^\n<]*)/g;
  let match;
  let cursor = 0;
  let currentTitle = "";
  while ((match = marker.exec(body)) !== null) {
    if (currentTitle) {
      chapters.push({ title: currentTitle, text: body.slice(cursor, match.index) });
    }
    currentTitle = match[1].trim() || "正文";
    cursor = match.index + match[0].length;
  }
  if (currentTitle) chapters.push({ title: currentTitle, text: body.slice(cursor) });

  const cleanChapters = chapters
    .map((chapter) => ({
      title: chapter.title.replace(/[*#<>\s]+/g, " ").trim().slice(0, 60) || "正文",
      text: cleanChapterText(chapter.text),
    }))
    .filter((chapter) => chapter.text.length > 0);

  if (cleanChapters.length > 1) return cleanChapters;

  // 退化方案：按「卷之X / 第X卷 / 第X章」等标题行切
  const lines = body.split("\n");
  const headingPattern = /^(卷[之第]?[一二三四五六七八九十百〇零0-9]+|第[一二三四五六七八九十百〇零0-9]+[卷章节篇回]|序|跋|凡例)\b/;
  const fallback = [];
  let title = "";
  let buffer = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed && headingPattern.test(trimmed) && trimmed.length <= 24) {
      if (buffer.length > 0 || title) fallback.push({ title: title || "正文", text: buffer.join("\n") });
      title = trimmed;
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  if (buffer.length > 0 || title) fallback.push({ title: title || "正文", text: buffer.join("\n") });
  const fallbackChapters = fallback
    .map((chapter) => ({ title: chapter.title.slice(0, 60), text: cleanChapterText(chapter.text) }))
    .filter((chapter) => chapter.text.length > 0);
  if (fallbackChapters.length > 1) return fallbackChapters;

  const whole = cleanChapterText(body);
  return whole ? [{ title: "全文", text: whole }] : [];
}

function cleanChapterText(raw) {
  return raw
    .replace(/^[\s]*属性[：:]\s*/, "")
    .replace(/^<[^>\n]{1,8}>/gm, "")
    .replace(/<\/?[^>\n]{1,8}>/g, "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function makeIntro(body) {
  const flat = body
    .replace(/<[^>\n]{1,10}>/g, " ")
    .replace(/属性[：:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return flat.slice(0, INTRO_LIMIT);
}

function parseBook(fileName, buffer) {
  const text = cleanText(decodeBuffer(buffer));
  const nameFromHeader = extractLine(text, "书名");
  const name = nameFromFile(fileName) || nameFromHeader;
  const author = extractLine(text, "作者");
  const dynasty = extractLine(text, "朝代");
  const source = [author, dynasty].filter(Boolean).join("·");
  const body = splitBody(text);
  const chapters = splitChapters(body);
  const bookText = chapters.length > 0 ? chapters.map((chapter) => chapter.text).join("\n\n") : "";
  const charCount = bookText.replace(/\s/g, "").length;
  return { name, author, dynasty, source, text: bookText, chapters, charCount, intro: makeIntro(body) };
}

async function saveBook(book) {
  const now = new Date().toISOString();
  const rawJson = JSON.stringify({
    text: book.text,
    chapters: book.chapters,
    source: BATCH_SOURCE,
    charCount: book.charCount,
    author: book.author,
    dynasty: book.dynasty,
    intro: book.intro,
  });
  const commentary = JSON.stringify({
    chars: book.charCount,
    chapters: book.chapters.length,
    author: book.author,
    dynasty: book.dynasty,
  });
  const payload = {
    rawJson,
    indication: book.intro,
    commentary,
    batchId: null,
  };

  const existing = await prisma.kbItem.findFirst({
    where: { type: "classic", name: book.name, source: book.source },
    select: { id: true, currentVersion: true },
  });
  if (existing) {
    const version = await prisma.kbItemVersion.findFirst({
      where: { kbItemId: existing.id, version: 1 },
      select: { id: true, commentary: true },
    });
    if (version && version.commentary === commentary) {
      return "unchanged";
    }
    if (version) {
      await prisma.kbItemVersion.update({ where: { id: version.id }, data: payload });
    } else {
      await prisma.kbItemVersion.create({ data: { kbItemId: existing.id, version: 1, ...payload, createdAt: now } });
    }
    await prisma.kbItem.update({ where: { id: existing.id }, data: { currentVersion: 1, updatedAt: now } });
    return "updated";
  }

  await prisma.kbItem.create({
    data: {
      type: "classic",
      name: book.name,
      source: book.source,
      currentVersion: 1,
      status: "active",
      createdAt: now,
      updatedAt: now,
      versions: { create: [{ version: 1, ...payload, createdAt: now }] },
    },
  });
  return "created";
}

async function main() {
  const files = (await fsp.readdir(SOURCE_DIR)).filter((file) => /\.txt$/i.test(file)).sort();
  if (files.length === 0) {
    throw new Error(`没有找到古籍 txt，请先下载到 ${SOURCE_DIR}`);
  }
  const queue = LIMIT > 0 ? files.slice(0, LIMIT) : files;
  console.log(`源目录: ${SOURCE_DIR}`);
  console.log(`待处理: ${queue.length} 部（目录内共 ${files.length} 个 txt）`);

  const stats = { created: 0, updated: 0, unchanged: 0, failed: [], duplicates: [], totalChars: 0 };
  const seen = new Set();
  const started = Date.now();

  for (let index = 0; index < queue.length; index += 1) {
    const fileName = queue[index];
    try {
      const buffer = await fsp.readFile(path.join(SOURCE_DIR, fileName));
      const book = parseBook(fileName, buffer);
      if (!book.name) throw new Error("书名为空");
      if (book.charCount < 20) throw new Error(`正文过短（${book.charCount} 字）`);
      const key = `${book.name}\u0000${book.source}`;
      if (seen.has(key)) {
        stats.duplicates.push({ file: fileName, name: book.name, source: book.source });
        continue;
      }
      seen.add(key);
      const outcome = await saveBook(book);
      stats[outcome] += 1;
      stats.totalChars += book.charCount;
      if (outcome !== "unchanged" && (index + 1) % 25 === 0) {
        console.log(
          `进度 ${index + 1}/${queue.length} 新建 ${stats.created} 更新 ${stats.updated} 未变 ${stats.unchanged} 失败 ${stats.failed.length}`,
        );
      }
    } catch (error) {
      stats.failed.push({ file: fileName, error: String(error?.message ?? error) });
      console.warn(`失败 ${fileName}: ${String(error?.message ?? error)}`);
    }
  }

  const count = await prisma.kbItem.count({ where: { type: "classic" } });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log("\n================ 导入完成 ================");
  console.log(`新建 ${stats.created} 部 / 更新 ${stats.updated} 部 / 未变 ${stats.unchanged} 部`);
  console.log(`总字数（去空白）: ${stats.totalChars.toLocaleString()} 字`);
  console.log(`kb_items(type='classic') 现有: ${count} 部`);
  console.log(`耗时 ${seconds}s`);
  console.log(`重名跳过: ${stats.duplicates.length} 个`);
  for (const duplicate of stats.duplicates) console.log(`  - ${duplicate.file} → 《${duplicate.name}》${duplicate.source}`);
  console.log(`失败: ${stats.failed.length} 个`);
  for (const failure of stats.failed) console.log(`  - ${failure.file}: ${failure.error}`);
}

main()
  .catch((error) => {
    console.error(`导入失败: ${String(error?.message ?? error)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
