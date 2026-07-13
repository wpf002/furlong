-- AlterTable: the full sales-catalog "black-type page" text for a hip (sire
-- summary, dam produce, female family). Populated at ingest when the source
-- carries it; NULL otherwise.
ALTER TABLE "Hip" ADD COLUMN IF NOT EXISTS "catalogPageText" TEXT;
