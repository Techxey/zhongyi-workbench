import { prisma } from "@/lib/db";

/**
 * 古籍：书名/作者/简介/章节数这类「轻」元数据进内存索引与列表页，
 * 正文（rawJson.text / rawJson.chapters 里的全文）只留在 SQLite，按需查询、按需取章节。
 *
 * 存储约定（见 scripts/import-classics.mjs）：
 *   kb_items.type = "classic"，source = "作者·朝代"
 *   kb_item_versions.raw_json = JSON.stringify({ text, chapters:[{title,text}], source, charCount, author, dynasty, intro })
 *   kb_item_versions.indication = 简介（正文前 200 字）
 *   kb_item_versions.commentary = JSON.stringify({ chars, chapters, author, dynasty })
 * 这样 kb-search 的内存索引与 /kb 列表页都不必 select raw_json（170MB 正文不进城）。
 */

export const CLASSIC_SOURCE = "TCM-Ancient-Books";
export const CLASSIC_INTRO_LIMIT = 200;
/** 全文检索时每本书只看正文前 N 个字符：SQLite 的 instr 用不上索引，限定范围换响应速度 */
export const CLASSIC_SEARCH_WINDOW = 30000;

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

function unescapeSnippet(raw: string): string {
  // raw_json 里取出来的是 JSON 字符串片段（不带外层引号），转义序列要还原
  return raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\"/g, '"')
    .replace(/\\n/g, " ")
    .replace(/\\r/g, " ")
    .replace(/\\t/g, " ")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\")
    .replace(/\s+/g, " ")
    .trim();
}

/** 去掉片段里可能沾到的 JSON 语法噪声与章节标题行 */
function cleanSnippet(raw: string | null | undefined): string {
  if (!raw) return "";
  return unescapeSnippet(raw)
    .replace(/^\{"text":"/, "")
    .replace(/^\{?"?[^：:]{0,8}(篇名|属性)[：:]?"?/, "")
    .replace(/^[{}":，,\s]+/, "")
    .replace(/"[,\]}].*$/, "")
    .slice(0, 160)
    .trim();
}

type ClassicTextRow = {
  itemId: string;
  name: string;
  source: string | null;
  commentary: string | null;
  indication: string | null;
  snippet: string | null;
  match_pos?: number | bigint | null;
};

function mapTextRow(row: ClassicTextRow): ClassicSearchHit {
  const meta = parseClassicMeta(row.commentary);
  return {
    itemId: row.itemId,
    name: row.name,
    source: row.source ?? null,
    snippet: cleanSnippet(row.snippet),
    intro: (row.indication ?? "").slice(0, CLASSIC_INTRO_LIMIT),
    chars: meta.chars,
    chapters: meta.chapters,
  };
}

/** rawJson 里换行会转义成 \n（2 字符/1 字），开窗按 1.5 倍留余量，保证覆盖正文前 3 万字 */
const SEARCH_WINDOW_CHARS = Math.round(CLASSIC_SEARCH_WINDOW * 1.5);

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

const SELECT_TEXT_FIELDS = `
  i.id AS itemId,
  i.name AS name,
  i.source AS source,
  v.commentary AS commentary,
  v.indication AS indication,
  instr(substr(v.raw_json, 1, ?), ?) AS match_pos,
  substr(v.raw_json, MAX(instr(substr(v.raw_json, 1, ?), ?) - 20, 1), 120) AS snippet
`;

/**
 * 只给「已经在书名/简介里命中的书」补正文片段：按 kb_item_id 走主键，只读这几行，
 * 不扫全库（全库 raw_json 共 ~180MB，扫一遍要 1s+，不能放在每次请求里）。
 */
export async function enrichClassicSnippets(query: string, ids: string[]): Promise<ClassicSearchHit[]> {
  const needle = query.trim();
  if (needle.length < 2 || ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const sql = `
    SELECT ${SELECT_TEXT_FIELDS}
    FROM kb_item_versions v
    JOIN kb_items i ON i.id = v.kb_item_id
    WHERE i.type = 'classic'
      AND i.status = 'active'
      AND v.version = i.current_version
      AND i.id IN (${placeholders})
    LIMIT ?
  `;
  const rows = await prisma.$queryRawUnsafe<ClassicTextRow[]>(
    sql,
    SEARCH_WINDOW_CHARS,
    needle,
    SEARCH_WINDOW_CHARS,
    needle,
    ...ids,
    ids.length,
  );
  return rows
    .filter((row) => Number(row.match_pos ?? 0) > 0)
    .sort((a, b) => Number(a.match_pos ?? 0) - Number(b.match_pos ?? 0))
    .map(mapTextRow);
}

/**
 * 正文全文检索：对 raw_json 做 instr 匹配、substr 取命中片段（前后各 20 字上下文）。
 *
 * 性能取舍（实测 701 部 / raw_json 180MB）：
 * - 按 i.name 顺序 + LIMIT 时，SQLite 命中足够条数就停，常见词约 100-300ms；
 * - 若 query 在全书几乎不出现，必须扫完整张表，约 1.1s（受磁盘读 180MB 限制）。
 *   所以结果进内存缓存 60s（globalThis.__zybClassicTextCache），重复查询 <1ms。
 * - 只扫描每本书正文前 CLASSIC_SEARCH_WINDOW(3 万字)，更靠后的正文不参与全文检索，
 *   这是写进 README 的已知限制；书名命中和章节浏览不受影响。
 */
export async function searchClassicText(query: string, limit = 6): Promise<ClassicSearchHit[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

  const cache = textCache();
  const cached = cache.get(needle);
  if (cached && Date.now() - cached.at < TEXT_CACHE_TTL_MS) return cached.hits;

  const sql = `
    SELECT ${SELECT_TEXT_FIELDS}
    FROM kb_item_versions v
    JOIN kb_items i ON i.id = v.kb_item_id
    WHERE i.type = 'classic'
      AND i.status = 'active'
      AND v.version = i.current_version
      AND instr(substr(v.raw_json, 1, ?), ?) > 0
    ORDER BY i.name ASC
    LIMIT ?
  `;
  const rows = await prisma.$queryRawUnsafe<ClassicTextRow[]>(
    sql,
    SEARCH_WINDOW_CHARS,
    needle,
    SEARCH_WINDOW_CHARS,
    needle,
    SEARCH_WINDOW_CHARS,
    needle,
    limit,
  );
  const hits = rows
    .filter((row) => Number(row.match_pos ?? 0) > 0)
    .sort((a, b) => Number(a.match_pos ?? 0) - Number(b.match_pos ?? 0))
    .map(mapTextRow);

  if (cache.size >= TEXT_CACHE_MAX) cache.clear();
  cache.set(needle, { at: Date.now(), hits });
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
