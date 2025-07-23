/*
  Warnings:

  - A unique constraint covering the columns `[locationId,timestamp]` on the table `WeatherData` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "WeatherData_locationId_timestamp_key" ON "WeatherData"("locationId", "timestamp");
