-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('COLT', 'FILLY', 'GELDING', 'MARE', 'STALLION');

-- CreateEnum
CREATE TYPE "AuctionHouse" AS ENUM ('KEENELAND', 'FASIG_TIPTON', 'TATTERSALLS', 'GOFFS', 'OBS', 'INGLIS');

-- CreateTable
CREATE TABLE "Horse" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "sex" "Sex",
    "color" TEXT,
    "foalingYear" INTEGER,
    "sireId" TEXT,
    "damId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Horse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consignor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consignor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Breeder" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Breeder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sale" (
    "id" TEXT NOT NULL,
    "auctionHouse" "AuctionHouse" NOT NULL,
    "name" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hip" (
    "id" TEXT NOT NULL,
    "saleId" TEXT NOT NULL,
    "hipNumber" INTEGER NOT NULL,
    "sessionNumber" INTEGER,
    "horseId" TEXT NOT NULL,
    "consignorId" TEXT,
    "breederId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SaleResult" (
    "id" TEXT NOT NULL,
    "hipId" TEXT NOT NULL,
    "priceCents" BIGINT,
    "rna" BOOLEAN NOT NULL DEFAULT false,
    "buyer" TEXT,
    "soldAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SaleResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Valuation" (
    "id" TEXT NOT NULL,
    "hipId" TEXT NOT NULL,
    "estValueLowCents" BIGINT NOT NULL,
    "estValueHighCents" BIGINT NOT NULL,
    "predPriceLowCents" BIGINT NOT NULL,
    "predPriceHighCents" BIGINT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "hiddenGemScore" DOUBLE PRECISION,
    "limitedComparables" BOOLEAN NOT NULL DEFAULT false,
    "modelVersion" TEXT NOT NULL,
    "summary" TEXT,
    "features" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Valuation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SireStats" (
    "id" TEXT NOT NULL,
    "sireId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "avgYearlingCents" BIGINT,
    "earningsPerStarter" BIGINT,
    "stakesWinnerPct" DOUBLE PRECISION,
    "studFeeCents" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SireStats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuyerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "budgetLowCents" BIGINT,
    "budgetHighCents" BIGINT,
    "preferredSires" TEXT[],
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuyerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shortlist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shortlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShortlistItem" (
    "id" TEXT NOT NULL,
    "shortlistId" TEXT NOT NULL,
    "hipId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShortlistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Horse_name_idx" ON "Horse"("name");

-- CreateIndex
CREATE INDEX "Horse_sireId_idx" ON "Horse"("sireId");

-- CreateIndex
CREATE INDEX "Horse_damId_idx" ON "Horse"("damId");

-- CreateIndex
CREATE UNIQUE INDEX "Consignor_name_key" ON "Consignor"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Breeder_name_key" ON "Breeder"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Sale_auctionHouse_name_year_key" ON "Sale"("auctionHouse", "name", "year");

-- CreateIndex
CREATE INDEX "Hip_horseId_idx" ON "Hip"("horseId");

-- CreateIndex
CREATE UNIQUE INDEX "Hip_saleId_hipNumber_key" ON "Hip"("saleId", "hipNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SaleResult_hipId_key" ON "SaleResult"("hipId");

-- CreateIndex
CREATE INDEX "Valuation_hipId_idx" ON "Valuation"("hipId");

-- CreateIndex
CREATE INDEX "Valuation_modelVersion_idx" ON "Valuation"("modelVersion");

-- CreateIndex
CREATE UNIQUE INDEX "SireStats_sireId_year_key" ON "SireStats"("sireId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ShortlistItem_shortlistId_hipId_key" ON "ShortlistItem"("shortlistId", "hipId");

-- AddForeignKey
ALTER TABLE "Horse" ADD CONSTRAINT "Horse_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Horse" ADD CONSTRAINT "Horse_damId_fkey" FOREIGN KEY ("damId") REFERENCES "Horse"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hip" ADD CONSTRAINT "Hip_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "Sale"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hip" ADD CONSTRAINT "Hip_horseId_fkey" FOREIGN KEY ("horseId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hip" ADD CONSTRAINT "Hip_consignorId_fkey" FOREIGN KEY ("consignorId") REFERENCES "Consignor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hip" ADD CONSTRAINT "Hip_breederId_fkey" FOREIGN KEY ("breederId") REFERENCES "Breeder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SaleResult" ADD CONSTRAINT "SaleResult_hipId_fkey" FOREIGN KEY ("hipId") REFERENCES "Hip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Valuation" ADD CONSTRAINT "Valuation_hipId_fkey" FOREIGN KEY ("hipId") REFERENCES "Hip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SireStats" ADD CONSTRAINT "SireStats_sireId_fkey" FOREIGN KEY ("sireId") REFERENCES "Horse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuyerProfile" ADD CONSTRAINT "BuyerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shortlist" ADD CONSTRAINT "Shortlist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShortlistItem" ADD CONSTRAINT "ShortlistItem_shortlistId_fkey" FOREIGN KEY ("shortlistId") REFERENCES "Shortlist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
