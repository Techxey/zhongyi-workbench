-- 患者门诊卡号（可空，可手工录入或后续扫码）
ALTER TABLE "patients" ADD COLUMN "card_no" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "patients_card_no_key" ON "patients"("card_no");
