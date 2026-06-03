-- AlterTable
ALTER TABLE "Breeder" ADD COLUMN     "normalizedName" TEXT NOT NULL;
-- AlterTable
ALTER TABLE "Consignor" ADD COLUMN     "normalizedName" TEXT NOT NULL;
-- AlterTable
ALTER TABLE "Horse" ADD COLUMN     "normalizedName" TEXT;
-- CreateIndex
CREATE UNIQUE INDEX "Breeder_normalizedName_key" ON "Breeder"("normalizedName");
-- CreateIndex
CREATE UNIQUE INDEX "Consignor_normalizedName_key" ON "Consignor"("normalizedName");
-- CreateIndex
CREATE INDEX "Horse_normalizedName_idx" ON "Horse"("normalizedName");
