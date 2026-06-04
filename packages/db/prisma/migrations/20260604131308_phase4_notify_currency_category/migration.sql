-- CreateEnum
CREATE TYPE "SaleCategory" AS ENUM ('YEARLING', 'BREEDING_STOCK', 'TWO_YEAR_OLD', 'WEANLING', 'MIXED', 'OTHER');

-- AlterTable
ALTER TABLE "Sale" ADD COLUMN     "category" "SaleCategory" NOT NULL DEFAULT 'YEARLING',
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'USD';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifySms" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "phone" TEXT;

