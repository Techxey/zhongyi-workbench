-- CreateTable
CREATE TABLE "consult_terms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "hint" TEXT,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "sort_no" INTEGER NOT NULL DEFAULT 0,
    "builtin" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "attachments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "visit_id" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'tongue',
    "file_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "stored_path" TEXT NOT NULL,
    "note" TEXT,
    "operator_id" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "attachments_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "attachments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "consult_terms_category_use_count_idx" ON "consult_terms"("category", "use_count");

-- CreateIndex
CREATE UNIQUE INDEX "consult_terms_category_term_key" ON "consult_terms"("category", "term");

-- CreateIndex
CREATE INDEX "attachments_patient_id_created_at_idx" ON "attachments"("patient_id", "created_at");

-- CreateIndex
CREATE INDEX "attachments_visit_id_idx" ON "attachments"("visit_id");
