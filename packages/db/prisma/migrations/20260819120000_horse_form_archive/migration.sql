-- Race-form archive built from the licensed results feed (2024-01-01 →).
CREATE TABLE "HorseFormLine" (
    "id" TEXT NOT NULL,
    "horseKey" TEXT NOT NULL,
    "horseName" TEXT NOT NULL,
    "regNumber" TEXT,
    "raceId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "track" TEXT NOT NULL,
    "region" TEXT,
    "finishPos" INTEGER,
    "fieldSize" INTEGER,
    "distanceFurlongs" DOUBLE PRECISION,
    "surface" TEXT,
    "going" TEXT,
    "raceClass" TEXT,
    "grade" TEXT,
    "blackType" TEXT,
    "totalPurseCents" BIGINT,
    "jockey" TEXT,
    "trainer" TEXT,
    "winningTime" TEXT,
    "sireName" TEXT,
    "damName" TEXT,
    "damSireName" TEXT,
    "sireKey" TEXT,
    "damKey" TEXT,
    "breederName" TEXT,
    "ownerName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HorseFormLine_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "HorseFormLine_horseKey_raceId_key" ON "HorseFormLine"("horseKey", "raceId");
CREATE INDEX "HorseFormLine_horseKey_idx" ON "HorseFormLine"("horseKey");
CREATE INDEX "HorseFormLine_sireKey_idx" ON "HorseFormLine"("sireKey");
CREATE INDEX "HorseFormLine_damKey_idx" ON "HorseFormLine"("damKey");
CREATE INDEX "HorseFormLine_regNumber_idx" ON "HorseFormLine"("regNumber");
CREATE INDEX "HorseFormLine_date_idx" ON "HorseFormLine"("date");

CREATE TABLE "FormIngestDay" (
    "date" TIMESTAMP(3) NOT NULL,
    "races" INTEGER NOT NULL DEFAULT 0,
    "formLines" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ok',
    "error" TEXT,
    "ingestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FormIngestDay_pkey" PRIMARY KEY ("date")
);
