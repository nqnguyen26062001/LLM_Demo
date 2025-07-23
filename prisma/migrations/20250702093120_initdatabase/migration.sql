
CREATE EXTENSION IF NOT EXISTS postgis;


-- CreateTable
CREATE TABLE "NewsArticle" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "image" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "sourceName" TEXT,
    "sourceUrl" TEXT,
    "language" TEXT,
    "content" TEXT,
    "query" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "locationId" TEXT NOT NULL,

    CONSTRAINT "NewsArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeatherData" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL,
    "feels_like" DOUBLE PRECISION NOT NULL,
    "temp_min" DOUBLE PRECISION NOT NULL,
    "temp_max" DOUBLE PRECISION NOT NULL,
    "pressure" INTEGER NOT NULL,
    "humidity" INTEGER NOT NULL,
    "visibility" INTEGER,
    "windSpeed" DOUBLE PRECISION NOT NULL,
    "windDeg" INTEGER,
    "cloudsAll" INTEGER,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "main" TEXT NOT NULL,
    "sunrise" TIMESTAMP(3),
    "sunset" TIMESTAMP(3),
    "timezoneOffset" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeatherData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationData" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "point" geometry(Point, 4326) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationData_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RouteData" (
    "id" TEXT NOT NULL,
    "startLocationId" TEXT NOT NULL,
    "endLocationId" TEXT NOT NULL,
    "path_geometry" geometry(LineString, 4326) NOT NULL,
    "duration_seconds" DOUBLE PRECISION NOT NULL,
    "distance_meters" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RouteData_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NewsArticle_url_key" ON "NewsArticle"("url");

-- CreateIndex
CREATE UNIQUE INDEX "LocationData_name_key" ON "LocationData"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RouteData_startLocationId_endLocationId_key" ON "RouteData"("startLocationId", "endLocationId");

-- AddForeignKey
ALTER TABLE "NewsArticle" ADD CONSTRAINT "NewsArticle_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeatherData" ADD CONSTRAINT "WeatherData_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "LocationData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteData" ADD CONSTRAINT "RouteData_startLocationId_fkey" FOREIGN KEY ("startLocationId") REFERENCES "LocationData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RouteData" ADD CONSTRAINT "RouteData_endLocationId_fkey" FOREIGN KEY ("endLocationId") REFERENCES "LocationData"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
