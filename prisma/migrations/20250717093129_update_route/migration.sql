-- CreateTable
CREATE TABLE "_LocationDataToRouteData" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_LocationDataToRouteData_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_LocationDataToRouteData_B_index" ON "_LocationDataToRouteData"("B");

-- AddForeignKey
ALTER TABLE "_LocationDataToRouteData" ADD CONSTRAINT "_LocationDataToRouteData_A_fkey" FOREIGN KEY ("A") REFERENCES "LocationData"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_LocationDataToRouteData" ADD CONSTRAINT "_LocationDataToRouteData_B_fkey" FOREIGN KEY ("B") REFERENCES "RouteData"("id") ON DELETE CASCADE ON UPDATE CASCADE;
