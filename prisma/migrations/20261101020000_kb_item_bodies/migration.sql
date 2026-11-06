-- 把古籍/医案的正文（raw_json，701 部合计 ~174MB）从 kb_item_versions 挪到独立表：
-- 列表、版本查询只扫 kb_item_versions（很小），不再被 174MB 的正文页拖慢。
CREATE TABLE "kb_item_bodies" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "version_id" TEXT NOT NULL,
    "raw_json" TEXT NOT NULL
);

CREATE UNIQUE INDEX "kb_item_bodies_version_id_key" ON "kb_item_bodies"("version_id");

INSERT INTO "kb_item_bodies" ("id", "version_id", "raw_json")
SELECT
    lower(hex(randomblob(4))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(2))) || '-' ||
    lower(hex(randomblob(6))),
    "id",
    "raw_json"
FROM "kb_item_versions"
WHERE "raw_json" IS NOT NULL;

ALTER TABLE "kb_item_versions" DROP COLUMN "raw_json";
