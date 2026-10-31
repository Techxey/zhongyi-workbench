-- DropIndex
DROP INDEX "idx_patients_name";

-- DropIndex
DROP INDEX "idx_visits_patient_at";

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_visit_revisions" (
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
    "remind_followup" BOOLEAN NOT NULL DEFAULT true,
    "amended_reason" TEXT,
    "operator_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "visit_revisions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_visit_revisions" ("advice", "amended_reason", "chief_complaint", "created_at", "followup_days", "id", "operator_id", "parent_revision_id", "present_illness", "pulse_json", "revision_no", "symptoms_json", "syndrome", "tongue_json", "treatment", "visit_id") SELECT "advice", "amended_reason", "chief_complaint", "created_at", "followup_days", "id", "operator_id", "parent_revision_id", "present_illness", "pulse_json", "revision_no", "symptoms_json", "syndrome", "tongue_json", "treatment", "visit_id" FROM "visit_revisions";
DROP TABLE "visit_revisions";
ALTER TABLE "new_visit_revisions" RENAME TO "visit_revisions";
CREATE UNIQUE INDEX "visit_revisions_visit_id_revision_no_key" ON "visit_revisions"("visit_id", "revision_no");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
