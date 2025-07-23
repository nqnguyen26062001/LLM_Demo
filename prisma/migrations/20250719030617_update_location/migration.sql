/*
  Warnings:

  - Added the required column `updatedAt` to the `RouteWaypoint` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "RouteWaypoint" ADD COLUMN     "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "updatedAt" TIMESTAMPTZ(6) NOT NULL;
