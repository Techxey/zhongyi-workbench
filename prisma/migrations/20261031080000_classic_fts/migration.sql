-- 古籍全文检索（FTS5）
-- 正文按「章」切块存普通表，同时建 contentless FTS5 表；
-- 中文没有空格，FTS5 的 unicode61 分词器会把整段中文当一整个 token，
-- 所以入库前把正文逐字用空格隔开（"失 眠 多 梦"），查询时把关键词也逐字隔开并用短语匹配。

CREATE TABLE IF NOT EXISTS "classic_chunks" (
    "rowid" INTEGER PRIMARY KEY AUTOINCREMENT,
    "item_id" TEXT NOT NULL,
    "chapter_no" INTEGER NOT NULL,
    "chapter_title" TEXT,
    "body" TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_classic_chunks_item" ON "classic_chunks"("item_id");

CREATE VIRTUAL TABLE IF NOT EXISTS "classic_fts" USING fts5(
    body,
    content='',
    tokenize='unicode61 remove_diacritics 0'
);
