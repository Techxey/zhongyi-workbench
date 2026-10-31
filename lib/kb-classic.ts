import { prisma } from "@/lib/db";

/**
 * 古籍：书名/作者/简介/章节数这类「轻」元数据进内存索引与列表页，
 * 正文（rawJson.text / rawJson.chapters 里的全文）另存一份到 classic_chunks 并按 FTS5 建索引。
 *
 * 存储约定（见 scripts/import-classics.mjs 与 scripts/build-classic-fts.mjs）：
 *   kb_items.type = "classic"，source = "作者·朝代"
 *   kb_item_versions.raw_json = JSON.stringify({ text, chapters:[{title,text}], source, charCount, author, dynasty, intro })
 *   kb_item_versions.indication = 简介（正文前 200 字）
 *   kb_item_versions.commentary = JSON.stringify({ chars, chapters, author, dynasty })
 *   classic_chunks(rowid, item_id, chapter_no, chapter_title, body)  —— 正文按章切块（全书，不止前 3 万字）
 *   classic_fts(body)  —— contentless FTS5，正文逐字空格分开后入库，查询用短语匹配
 *
 * 为什么逐字空格：SQLite 的 unicode61 分词器不分中文，整段中文会变成一个 token；
 * 入库前把「失眠多梦」写成「失 眠 多 梦」，查询时把关键词也逐字写成 "失 眠" 做短语匹配，
 * 这样任意长度（含单字）的中文查询都能走索引，且保证相邻顺序。
 */

export const CLASSIC_SOURCE = "TCM-Ancient-Books";
export const CLASSIC_INTRO_LIMIT = 200;

/** 正文命中时最多取多少块再按书去重（一本书可能命中很多章） */
const FTS_ROW_LIMIT = 400;
const SNIPPET_PAD = 22;

export type ClassicChapter = { title: string; text: string };

export type ClassicMeta = { chars: number; chapters: number; author: string; dynasty: string };

export type ClassicSearchHit = {
  itemId: string;
  name: string;
  source: string | null;
  snippet: string;
  intro: string;
  chars: number;
  chapters: number;
  /** 命中的章名（详情/列表展示用，可能为空） */
  chapterTitle?: string | null;
};

export type ClassicBook = {
  id: string;
  name: string;
  source: string | null;
  status: string;
  intro: string;
  chars: number;
  chapters: ClassicChapter[];
};

/** commentary 里存的是轻量元数据，坏了就当没有 */
export function parseClassicMeta(commentary: string | null | undefined): ClassicMeta {
  const empty: ClassicMeta = { chars: 0, chapters: 0, author: "", dynasty: "" };
  if (!commentary) return empty;
  try {
    const parsed = JSON.parse(commentary) as Partial<ClassicMeta>;
    return {
      chars: Number(parsed.chars ?? 0) || 0,
      chapters: Number(parsed.chapters ?? 0) || 0,
      author: String(parsed.author ?? ""),
      dynasty: String(parsed.dynasty ?? ""),
    };
  } catch {
    return empty;
  }
}

/** 从 raw_json 里反解出一本书；坏数据返回 null 而不是抛错 */
export function parseClassicRaw(rawJson: string | null | undefined): {
  text: string;
  chapters: ClassicChapter[];
  charCount: number;
  intro: string;
} | null {
  if (!rawJson) return null;
  try {
    const parsed = JSON.parse(rawJson) as {
      text?: unknown;
      chapters?: unknown;
      charCount?: unknown;
      intro?: unknown;
    };
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const chapters: ClassicChapter[] = Array.isArray(parsed.chapters)
      ? parsed.chapters
          .map((chapter) => {
            const entry = chapter as { title?: unknown; text?: unknown };
            const title = typeof entry?.title === "string" ? entry.title : "";
            const body = typeof entry?.text === "string" ? entry.text : "";
            return title || body ? { title: title || "正文", text: body } : null;
          })
          .filter((chapter): chapter is ClassicChapter => chapter !== null)
      : [];
    const charCount = typeof parsed.charCount === "number" ? parsed.charCount : text.length;
    const intro = typeof parsed.intro === "string" ? parsed.intro : "";
    return { text, chapters: chapters.length > 0 ? chapters : text ? [{ title: "全文", text }] : [], charCount, intro };
  } catch {
    return null;
  }
}

/** 正文片段：命中位置前后各取一段，压掉换行与多余空白 */
function makeSnippet(body: string, needle: string): string {
  const flat = body.replace(/\s+/g, " ");
  const index = flat.indexOf(needle);
  if (index < 0) {
    const lower = flat.toLowerCase();
    const fallback = lower.indexOf(needle.toLowerCase());
    if (fallback < 0) return flat.slice(0, 120);
    return clip(flat, fallback, needle.length);
  }
  return clip(flat, index, needle.length);
}

function clip(flat: string, index: number, length: number): string {
  const from = Math.max(index - SNIPPET_PAD, 0);
  const to = Math.min(index + length + SNIPPET_PAD + 40, flat.length);
  const head = from > 0 ? "…" : "";
  const tail = to < flat.length ? "…" : "";
  return `${head}${flat.slice(from, to).trim()}${tail}`;
}

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

/**
 * 把查询词拆成 FTS5 短语：中文逐字、英文数字按词，中间用空格连接后整体加引号，
 * 这样 "失眠" → `"失 眠"`（相邻且有序），"huang qi" → `"huang qi"`。
 */
export function buildClassicFtsQuery(query: string): string | null {
  const tokens: string[] = [];
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
  if (tokens.length === 0) return null;
  return `"${tokens.join(" ")}"`;
}

const TEXT_CACHE_TTL_MS = 60_000;
const TEXT_CACHE_MAX = 200;

type ClassicTextCacheEntry = { at: number; hits: ClassicSearchHit[] };

function textCache(): Map<string, ClassicTextCacheEntry> {
  const holder = globalThis as unknown as { __zybClassicTextCache?: Map<string, ClassicTextCacheEntry> };
  if (!holder.__zybClassicTextCache) holder.__zybClassicTextCache = new Map();
  return holder.__zybClassicTextCache;
}

/** 导入/停用古籍后清一下正文检索缓存 */
export function invalidateClassicTextCache() {
  textCache().clear();
}

type ClassicFtsRow = {
  itemId: string;
  chapterTitle: string | null;
  name: string;
  source: string | null;
  commentary: string | null;
  indication: string | null;
  body: string;
};

function mapFtsRow(row: ClassicFtsRow, needle: string): ClassicSearchHit {
  const meta = parseClassicMeta(row.commentary);
  return {
    itemId: row.itemId,
    name: row.name,
    source: row.source ?? null,
    snippet: makeSnippet(row.body, needle),
    intro: (row.indication ?? "").slice(0, CLASSIC_INTRO_LIMIT),
    chars: meta.chars,
    chapters: meta.chapters,
    chapterTitle: row.chapterTitle ?? null,
  };
}

/**
 * 只给「已经在书名/简介里命中的书」补正文片段。
 * 走 classic_chunks 的 item_id 索引，只扫这几本书的分章正文（全书，不限前 3 万字）。
 */
export async function enrichClassicSnippets(query: string, ids: string[]): Promise<ClassicSearchHit[]> {
  const needle = query.trim();
  if (needle.length < 1 || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const sql = `
    SELECT
      c.item_id AS itemId,
      c.chapter_title AS chapterTitle,
      i.name AS name,
      i.source AS source,
      v.commentary AS commentary,
      v.indication AS indication,
      c.body AS body
    FROM classic_chunks c
    JOIN kb_items i ON i.id = c.item_id
    JOIN kb_item_versions v ON v.kb_item_id = i.id AND v.version = i.current_version
    WHERE i.type = 'classic'
      AND i.status = 'active'
      AND c.item_id IN (${placeholders})
      AND instr(c.body, ?) > 0
    ORDER BY c.chapter_no ASC
    LIMIT ?
  `;
  const rows = await prisma.$queryRawUnsafe<ClassicFtsRow[]>(sql, ...ids, needle, ids.length);
  const seen = new Set<string>();
  const hits: ClassicSearchHit[] = [];
  for (const row of rows) {
    if (seen.has(row.itemId)) continue;
    seen.add(row.itemId);
    hits.push(mapFtsRow(row, needle));
  }
  return hits;
}

/**
 * 正文全文检索：走 classic_fts 的 FTS5 索引（覆盖全书，不再只看前 3 万字）。
 * 中文查询被拆成逐字短语，FTS5 用位置列表匹配相邻字，典型查询 10-40ms；
 * 单字查询命中面很大会被 FTS_ROW_LIMIT 截断，再按书去重取前 limit 本。
 */
export async function searchClassicText(query: string, limit = 6): Promise<ClassicSearchHit[]> {
  const needle = query.trim();
  if (needle.length < 1) return [];

  const ftsQuery = buildClassicFtsQuery(needle);
  if (!ftsQuery) return [];

  const cache = textCache();
  const cacheKey = `${limit}:${needle}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < TEXT_CACHE_TTL_MS) return cached.hits;

  const sql = `
    SELECT
      c.item_id AS itemId,
      c.chapter_title AS chapterTitle,
      i.name AS name,
      i.source AS source,
      v.commentary AS commentary,
      v.indication AS indication,
      c.body AS body
    FROM classic_fts
    JOIN classic_chunks c ON c.rowid = classic_fts.rowid
    JOIN kb_items i ON i.id = c.item_id
    JOIN kb_item_versions v ON v.kb_item_id = i.id AND v.version = i.current_version
    WHERE classic_fts MATCH ?
      AND i.type = 'classic'
      AND i.status = 'active'
    LIMIT ?
  `;

  const rows = await prisma.$queryRawUnsafe<ClassicFtsRow[]>(sql, ftsQuery, FTS_ROW_LIMIT);

  const byItem = new Map<string, ClassicFtsRow>();
  for (const row of rows) {
    const current = byItem.get(row.itemId);
    if (!current) {
      byItem.set(row.itemId, row);
      continue;
    }
    // 书名里直接有查询词的优先，其次保留先命中的那一章
    if (!current.name.includes(needle) && row.name.includes(needle)) byItem.set(row.itemId, row);
  }

  const hits = Array.from(byItem.values())
    .sort((a, b) => {
      const aName = a.name.includes(needle) ? 1 : 0;
      const bName = b.name.includes(needle) ? 1 : 0;
      if (aName !== bName) return bName - aName;
      return a.name.localeCompare(b.name, "zh-Hans-CN");
    })
    .slice(0, limit)
    .map((row) => mapFtsRow(row, needle));

  if (cache.size >= TEXT_CACHE_MAX) cache.clear();
  cache.set(cacheKey, { at: Date.now(), hits });
  return hits;
}

/** 取一册书的简介与章节（详情抽屉、Ctrl+K 展开条文用） */
export async function getClassicBook(id: string): Promise<ClassicBook | null> {
  const item = await prisma.kbItem.findUnique({
    where: { id },
    select: {
      id: true,
      type: true,
      name: true,
      source: true,
      status: true,
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: { rawJson: true, indication: true, commentary: true },
      },
    },
  });
  if (!item || item.type !== "classic") return null;
  const version = item.versions[0];
  const raw = parseClassicRaw(version?.rawJson ?? null);
  const meta = parseClassicMeta(version?.commentary ?? null);
  return {
    id: item.id,
    name: item.name,
    source: item.source,
    status: item.status,
    intro: version?.indication || raw?.intro || "",
    chars: meta.chars || raw?.charCount || 0,
    chapters: raw?.chapters ?? [],
  };
}
