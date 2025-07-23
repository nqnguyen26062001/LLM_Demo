/*
  Warnings:

  - A unique constraint covering the columns `[startLocationId,endLocationId]` on the table `RouteData` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "RouteData_startLocationId_endLocationId_key" ON "RouteData"("startLocationId", "endLocationId");
