-- DropForeignKey
ALTER TABLE "NewsArticle" DROP CONSTRAINT "NewsArticle_locationId_fkey";

-- AlterTable
ALTER TABLE "NewsArticle" ALTER COLUMN "locationId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationData"("id") ON DELETE SET NULL ON UPDATE CASCADE;
