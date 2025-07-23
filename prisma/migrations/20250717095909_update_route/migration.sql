/*
  Warnings:

  - You are about to drop the `_LocationDataToRouteData` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "_LocationDataToRouteData" DROP CONSTRAINT "_LocationDataToRouteData_A_fkey";

-- DropForeignKey
ALTER TABLE "_LocationDataToRouteData" DROP CONSTRAINT "_LocationDataToRouteData_B_fkey";

-- DropIndex
DROP INDEX "RouteData_startLocationId_endLocationId_key";

-- DropTable
DROP TABLE "_LocationDataToRouteData";

-- CreateTable
CREATE TABLE "RouteWaypoint" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,

    CONSTRAINT "RouteWaypoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RouteWaypoint_routeId_order_key" ON "RouteWaypoint"("routeId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "RouteWaypoint_routeId_locationId_key" ON "RouteWaypoint"("routeId", "locationId");

-- AddForeignKey
ALTER TABLE "RouteWaypoint" ADD CONSTRAINT "RouteWaypoint_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "RouteData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteWaypoint" ADD CONSTRAINT "RouteWaypoint_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
