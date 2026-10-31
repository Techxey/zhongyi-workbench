-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "username" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'doctor',
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "birth_year" INTEGER,
    "phone" TEXT,
    "constitution" TEXT,
    "allergy" TEXT,
    "past_history" TEXT,
    "note" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "visits" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "patient_id" TEXT NOT NULL,
    "visit_no" INTEGER NOT NULL,
    "visit_at" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "current_revision_id" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "visits_patient_id_fkey" FOREIGN KEY ("patient_id") REFERENCES "patients" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "visit_revisions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visit_id" TEXT NOT NULL,
    "revision_no" INTEGER NOT NULL,
    "parent_revision_id" TEXT,
    "chief_complaint" TEXT,
    "present_illness" TEXT,
    "symptoms_json" TEXT,
    "tongue_json" TEXT,
    "pulse_json" TEXT,
    "syndrome" TEXT,
    "treatment" TEXT,
    "advice" TEXT,
    "followup_days" INTEGER,
    "amended_reason" TEXT,
    "operator_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "visit_revisions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "visit_revision_id" TEXT NOT NULL,
    "formula_name" TEXT,
    "formula_source" TEXT,
    "kb_item_id" TEXT,
    "kb_item_version" INTEGER,
    "doses" INTEGER,
    "usage_text" TEXT,
    "snapshot_json" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "prescriptions_visit_revision_id_fkey" FOREIGN KEY ("visit_revision_id") REFERENCES "visit_revisions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prescription_id" TEXT NOT NULL,
    "herb_name" TEXT NOT NULL,
    "dose" TEXT,
    "dose_value" REAL,
    "dose_unit" TEXT,
    "role" TEXT,
    "sort_no" INTEGER NOT NULL,
    "note" TEXT,
    CONSTRAINT "prescription_items_prescription_id_fkey" FOREIGN KEY ("prescription_id") REFERENCES "prescriptions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kb_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "source" TEXT,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "kb_item_versions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kb_item_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "composition_json" TEXT,
    "efficacy" TEXT,
    "indication" TEXT,
    "usage_text" TEXT,
    "contraindication" TEXT,
    "commentary" TEXT,
    "raw_json" TEXT,
    "batch_id" TEXT,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "kb_item_versions_kb_item_id_fkey" FOREIGN KEY ("kb_item_id") REFERENCES "kb_items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kb_aliases" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kb_item_id" TEXT,
    "term" TEXT NOT NULL,
    "norm_term" TEXT NOT NULL,
    "alias_type" TEXT NOT NULL,
    "weight" REAL NOT NULL DEFAULT 1,
    CONSTRAINT "kb_aliases_kb_item_id_fkey" FOREIGN KEY ("kb_item_id") REFERENCES "kb_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "kb_import_batches" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "filename" TEXT,
    "total_rows" INTEGER,
    "ok_rows" INTEGER,
    "warn_rows" INTEGER,
    "error_rows" INTEGER,
    "operator_id" TEXT,
    "created_at" TEXT NOT NULL,
    "rolled_back" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "before_json" TEXT,
    "after_json" TEXT,
    "operator_id" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "template_prescriptions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL DEFAULT 'favorite',
    "name" TEXT NOT NULL,
    "formula_name" TEXT,
    "formula_source" TEXT,
    "composition_json" TEXT NOT NULL,
    "usage_text" TEXT,
    "note" TEXT,
    "created_by" TEXT,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "template_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "template_id" TEXT NOT NULL,
    "herb_name" TEXT NOT NULL,
    "dose" TEXT,
    "dose_value" REAL,
    "dose_unit" TEXT,
    "sort_no" INTEGER NOT NULL,
    CONSTRAINT "template_items_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "template_prescriptions" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "symptom_terms" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "term" TEXT NOT NULL,
    "norm_term" TEXT NOT NULL,
    "use_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "herb_incompatibilities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "herb_a" TEXT NOT NULL,
    "herb_b" TEXT NOT NULL,
    "rule" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "visits_patient_id_visit_no_key" ON "visits"("patient_id", "visit_no");

-- CreateIndex
CREATE UNIQUE INDEX "visit_revisions_visit_id_revision_no_key" ON "visit_revisions"("visit_id", "revision_no");

-- CreateIndex
CREATE UNIQUE INDEX "kb_items_type_name_source_key" ON "kb_items"("type", "name", "source");

-- CreateIndex
CREATE UNIQUE INDEX "kb_item_versions_kb_item_id_version_key" ON "kb_item_versions"("kb_item_id", "version");

-- CreateIndex
CREATE INDEX "kb_aliases_norm_term_idx" ON "kb_aliases"("norm_term");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "symptom_terms_norm_term_key" ON "symptom_terms"("norm_term");

-- CreateIndex
CREATE INDEX "herb_incompatibilities_herb_a_idx" ON "herb_incompatibilities"("herb_a");
