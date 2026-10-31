-- CreateTable
CREATE TABLE "visit_drafts" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visit_id" TEXT NOT NULL,
    "data_json" TEXT NOT NULL,
    "operator_id" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "visit_drafts_visit_id_key" ON "visit_drafts"("visit_id");
