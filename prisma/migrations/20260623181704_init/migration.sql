-- CreateTable
CREATE TABLE "Celebrity" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "heightCm" INTEGER NOT NULL,
    "nationality" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "netWorthUsd" BIGINT NOT NULL,
    "instagramFollowers" BIGINT NOT NULL,
    "collaborators" TEXT[],

    CONSTRAINT "Celebrity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Celebrity_name_key" ON "Celebrity"("name");
