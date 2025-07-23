// src/tools/locationTool.ts
import axios from 'axios';
import prisma from '../libs/prisma';
import { PrismaClient ,Prisma} from '../generated/prisma'; 
import { DynamicStructuredTool,DynamicStructuredToolInput } from "@langchain/core/tools";
import { v4 as uuidv4 } from 'uuid'; // Add this line at the top of your file
import {z} from 'zod';
// Các biến môi trường và interface đã định nghĩa trước đó
const NOMINATIM_API_URL =  'https://nominatim.openstreetmap.org/search';
const OSRM_API_URL = 'http://router.project-osrm.org/route/v1/driving'; // Public OSRM API

interface NominatimResult {
    place_id: number;
    licence: string;
    osm_type: string;
    osm_id: number;
    lat: string; // Vĩ độ từ Nominatim
    lon: string; // Kinh độ từ Nominatim
    display_name: string;
    class: string;
    type: string;
    importance: number;
    icon?: string;
    boundingbox: string[];
}

/**
 * Lấy tọa độ và ID của một địa điểm dựa trên tên.
 * Ưu tiên kiểm tra trong cơ sở dữ liệu trước. Nếu không có, sẽ gọi Nominatim API của OpenStreetMap.
 * Dữ liệu sẽ được lưu vào hoặc cập nhật trong bảng LocationData.
 * @param locationName Tên địa điểm cần tìm kiếm (ví dụ: "Hà Nội").
 * @returns { id: string, latitude: number, longitude: number, displayName: string } hoặc null nếu không tìm thấy.
 */
export async function getCoordinatesForLocation(location: string): Promise<{ id: string; latitude: number; longitude: number; displayName: string } | null> {
    try {

        const locationName = location.trim();
        const existingLocation = await prisma.$queryRaw<{ id: string; name: string; latitude: number; longitude: number }[]>(
            Prisma.sql`
            SELECT
                id,
                name,
                ST_Y(point) AS latitude,
                ST_X(point) AS longitude
            FROM "LocationData"
            WHERE name = ${locationName.trim()}
            LIMIT 1;
            `
        );

        if (existingLocation && existingLocation.length > 0) {
            const loc = existingLocation[0];
            console.log(`[LocationTool] Found "${locationName}" in DB: (${loc.latitude}, ${loc.longitude})`);
            return {
                id: loc.id,
                latitude: loc.latitude,
                longitude: loc.longitude,
                displayName: loc.name
            };
        }

        console.log(`[LocationTool] "${locationName}" not found in DB, calling Nominatim API...`);

        const response = await axios.get<NominatimResult[]>(NOMINATIM_API_URL, {
            params: {
                q: locationName,
                format: 'json',
                limit: 1,
                'accept-language': 'vi'
            },
        });

        if (response.data && response.data.length > 0) {
            const result = response.data[0];
            const latitude = parseFloat(result.lat);
            const longitude = parseFloat(result.lon);

            await prisma.$executeRaw(
                Prisma.sql`
                INSERT INTO "LocationData" (id, name, point, "createdAt", "updatedAt")
                VALUES (gen_random_uuid(), ${locationName}, ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326), NOW(), NOW())
                ON CONFLICT (name) DO UPDATE
                SET point = ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326),
                    "updatedAt" = NOW();
                `
            );

            const newLocation = await prisma.locationData.findUnique({
                where: { name: locationName },
                select: { id: true }
            });

            if (!newLocation) {
                throw new Error("Failed to retrieve new location after upsert.");
            }

            console.log(`[LocationTool] Saved "${locationName}" (${latitude}, ${longitude}) to DB.`);
            return { latitude, longitude, displayName: result.display_name, id: newLocation.id };
        }

        return null;
    } catch (error: any) {
        console.error(`[LocationTool] Error getting coordinates for "${location}":`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[LocationTool] Nominatim API Error Response:`, error.response.data);
        }
        return null;
    }
}

function buildGoogleMapsUrl(originCoords: [number, number], destinationCoords: [number, number]): string {
  const originLat = originCoords[1]; // Vĩ độ
  const originLon = originCoords[0]; // Kinh độ
  const destLat = destinationCoords[1];
  const destLon = destinationCoords[0];

  return `https://www.google.com/maps/dir/?api=1&origin=${originLat},${originLon}&destination=${destLat},${destLon}&travelmode=driving`;
}

/**
 * Lấy dữ liệu đường đi giữa hai địa điểm.
 * Ưu tiên kiểm tra trong cơ sở dữ liệu (bảng RouteData) trước.
 * Nếu không có, sẽ gọi OSRM API để tính toán và lưu trữ.
 * @param startLocationName Tên địa điểm bắt đầu (ví dụ: "Hà Nội").
 * @param endLocationName Tên địa điểm kết thúc (ví dụ: "TP. Hồ Chí Minh").
 * @returns { duration: number; distance: number; instructions: string[] } hoặc null.
 */
function formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours > 0) {
        return `${hours} giờ ${minutes} phút`;
    }
    return `${minutes} phút`;
}

function formatDistance(meters: number): string {
    const km = (meters / 1000).toFixed(1);
    return `${km} km`;
}

function buildGoogleMapsDirectionsUrl(startLat: number, startLon: number, endLat: number, endLon: number): string {
    // Đây là một URL cơ bản cho chỉ đường trên Google Maps
    // Nó sẽ mở Google Maps với tuyến đường đã được tính toán.
    return `https://www.google.com/maps/dir/${startLat},${startLon}/${endLat},${endLon}`;
}
function buildGoogleMapsDirectionsUrlForWayPoints(waypoint : Array< { latitude: number; longitude: number }>): string {
    // Đây là một URL cơ bản cho chỉ đường trên Google Maps
    // Nó sẽ mở Google Maps với tuyến đường đã được tính toán.
    const coordinateString = waypoint.map(coord => `${coord.longitude},${coord.latitude}`).join(';');
    
    return `https://www.google.com/maps/dir/${coordinateString}`;
}

/**
 * Hàm thực hiện Reverse Geocoding để lấy chi tiết địa chỉ từ tọa độ.
 * Sử dụng OpenStreetMap Nominatim API.
 * @param latitude Vĩ độ
 * @param longitude Kinh độ
 * @returns Chuỗi chi tiết địa chỉ hoặc thông báo lỗi
 */
export  async function _getDetailedAddress(latitude: number, longitude: number): Promise<string> {
    try {
        const response = await axios.get('https://nominatim.openstreetmap.org/reverse', {
            params: {
                lat: latitude,
                lon: longitude,
                format: 'jsonv2', // Định dạng JSON version 2
                'accept-language': 'vi', // Yêu cầu kết quả bằng tiếng Việt
                zoom: 18 // Mức độ chi tiết của địa chỉ (tối đa 18 cho địa chỉ cụ thể)
            },
        });

        if (response.data && response.data.display_name) {
            const address = response.data.display_name;
            return `${address}`;
        } else {
            console.warn("Không tìm thấy địa chỉ chi tiết hoặc dữ liệu không hợp lệ từ Nominatim:", response.data);
            return `Không tìm thấy địa chỉ chi tiết cho tọa độ Vĩ độ ${latitude}, Kinh độ ${longitude}.`;
        }
    } catch (error) {
        if (axios.isAxiosError(error) && error.response) {
            console.error(`Lỗi khi gọi Nominatim API: ${error.response.status} - ${error.response.data}`);
            return `Lỗi khi lấy địa chỉ chi tiết: ${error.response.status}. Vui lòng thử lại sau hoặc kiểm tra giới hạn sử dụng.`;
        }
        console.error("Lỗi mạng hoặc server khi tra cứu địa chỉ Nominatim:", error);
        return "Lỗi: Không thể kết nối để tra cứu địa chỉ chi tiết.";
    }
}



// export async function getRouteDirections(
//         startLocationName?: string,
//         startLatitude?: number,
//         startLongitude?: number,
//         endLocationName?: string,
//         endLatitude?: number,
//         endLongitude?: number
// ): Promise<{
//     durationSeconds: number; // Thời gian gốc bằng giây
//     distanceMeters: number;  // Khoảng cách gốc bằng mét
//     formattedDuration: string; // Thời gian đã định dạng
//     formattedDistance: string; // Khoảng cách đã định dạng
//     mapUrl: string; // URL bản đồ
// } | null> {

//     try {
//         let startCoords: { id: string; latitude: number; longitude: number; } | null = null;
//          let endCoords: { id: string; latitude: number; longitude: number; } | null = null;

//         // Bước 1: Lấy tọa độ và ID của địa điểm bắt đầu và kết thúc
//         if (startLocationName ) {
//              startCoords = await getCoordinatesForLocation(startLocationName);
//         }else if (startLatitude !== undefined && startLongitude !== undefined) {
//             const detailedAddress = await _getDetailedAddress(startLatitude, startLongitude);
//             console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${detailedAddress}"`);

//              startCoords = await getCoordinatesForLocation( detailedAddress);
//             console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${startCoords}"`);
//             if (!startCoords) {
//                 // Nếu không tìm thấy tọa độ với địa chỉ chi tiết đã xử lý, thử với phiên bản đơn giản hơn (fallback)
//                 console.warn(`[LocationTool] Failed to get coordinates for processed detailed start address. Attempting simpler address.`);
//                 const parts = detailedAddress.split(',').map(part => part.trim());
//                 let simplerAddress = '';

//                 if (parts.length >= 5) {
//                     const district = parts[parts.length - 4];
//                     const city = parts[parts.length - 3];
//                     simplerAddress = `${district}, ${city}`;
//                 } else if (parts.length >= 2) {
//                     const city = parts[parts.length - 2];
//                     const country = parts[parts.length - 1];
//                     simplerAddress = `${city}, ${country}`;
//                 }

//                 if (simplerAddress) {
//                     console.warn(`[LocationTool] Trying simpler start address: "${simplerAddress}"`);
//                     startCoords = await getCoordinatesForLocation(simplerAddress);
//                 }
//             }

//         }

//         if (endLocationName ) {
//              endCoords = await getCoordinatesForLocation(endLocationName);
//         }else if (endLatitude !== undefined && endLongitude !== undefined) {
//             const detailedAddress = await _getDetailedAddress(endLatitude, endLongitude);
//             console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${detailedAddress}"`);

//              endCoords =  await getCoordinatesForLocation( await _getDetailedAddress(endLatitude, endLongitude));
//                          console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${detailedAddress}"`);
//             if (!endCoords) {
//                 // Nếu không tìm thấy tọa độ với địa chỉ chi tiết đã xử lý, thử với phiên bản đơn giản hơn (fallback)
//                 console.warn(`[LocationTool] Failed to get coordinates for processed detailed end address. Attempting simpler address.`);
//                 const parts = detailedAddress.split(',').map(part => part.trim());
//                 let simplerAddress = '';

//                 if (parts.length >= 5) {
//                     const district = parts[parts.length - 4];
//                     const city = parts[parts.length - 3];
//                     simplerAddress = `${district}, ${city}`;
//                 } else if (parts.length >= 2) {
//                     const city = parts[parts.length - 2];
//                     const country = parts[parts.length - 1];
//                     simplerAddress = `${city}, ${country}`;
//                 }

//                 if (simplerAddress) {
//                     console.warn(`[LocationTool] Trying simpler end address: "${simplerAddress}"`);
//                     endCoords = await getCoordinatesForLocation(simplerAddress);
//                 }
//             }

//         }
//         if (!startCoords || !endCoords) {
//             console.warn(`[LocationTool] Could not get valid coordinates for start or end location. Cannot calculate route.`);
//             return null; // Thoát khỏi hàm nếu thiếu thông tin
//         }

//         console.log(`[LocationTool] Start Coords: (${startCoords.latitude}, ${startCoords.longitude}, ID: ${startCoords.id})`);
//         console.log(`[LocationTool] End Coords: (${endCoords.latitude}, ${endCoords.longitude}, ID: ${endCoords.id})`);

//         // Bước 2: Kiểm tra trong database PostGIS (bảng RouteData)
//         const existingRoute = await prisma.routeData.findFirst({
//             where: {
//                 startLocationId: startCoords.id,
//                 endLocationId: endCoords.id,
//                 waypoints: { none: {} } // Đảm bảo đây là route không có waypoint
//             }
//         });

//         if (existingRoute && existingRoute.distance_meters) {
//             console.log(`[LocationTool] Found cached route from "${startLocationName}" to "${endLocationName}" in DB.`);
//             const formattedDur = formatDuration(existingRoute.duration_seconds);
//             const formattedDist = formatDistance(existingRoute.distance_meters);
//             const mapUrl = buildGoogleMapsDirectionsUrl(
//                 startCoords.latitude, startCoords.longitude,
//                 endCoords.latitude, endCoords.longitude
//             );

//             return {
//                 durationSeconds: existingRoute.duration_seconds,
//                 distanceMeters: existingRoute.distance_meters,
//                 formattedDuration: formattedDur,
//                 formattedDistance: formattedDist,
//                 mapUrl: mapUrl
//             };
//         }


//         console.log(`[LocationTool] Calling OSRM API for route from "${startLocationName}" to "${endLocationName}"...`);

//         // Bước 3: Gọi OSRM API nếu không có trong DB
//         const response = await axios.get(`${OSRM_API_URL}/${startCoords.longitude},${startCoords.latitude};${endCoords.longitude},${endCoords.latitude}`, {
//             params: {
//                 alternatives: false,
//                 steps: true, // Để lấy chi tiết các bước rẽ
//                 geometries: 'geojson', // Lấy định dạng GeoJSON cho đường đi
//                 overview: 'full'
//             }
//         });

//         console.log(`[LocationTool] OSRM API Response:`, response.data.routes[0]);

//         if (response.data && response.data.routes && response.data.routes.length > 0) {
//             const route = response.data.routes[0];
//             const duration = route.duration; // Thời gian di chuyển (giây)
//             const distance = route.distance; // Khoảng cách (mét)
//             const routeGeometryGeoJSON = JSON.stringify(route.geometry); // OSRM trả về geometry dưới dạng GeoJSON
//             const formattedDur = formatDuration(duration);
//             const formattedDist = formatDistance(distance);
//             const mapUrl = buildGoogleMapsDirectionsUrl(
//                 startCoords.latitude, startCoords.longitude,
//                 endCoords.latitude, endCoords.longitude
//             );

//             // Bước 4: Lưu thông tin tuyến đường vào database PostGIS
//             // Chèn GeoJSON LineString vào cột path_geometry
//             await prisma.$executeRaw(
//                 Prisma.sql`
//                 INSERT INTO "RouteData" (id, "startLocationId", "endLocationId", path_geometry, duration_seconds, distance_meters, "createdAt", "updatedAt")
//                 VALUES (
//                     gen_random_uuid(),
//                     ${startCoords.id}::uuid, -- Ép kiểu thành uuid
//                     ${endCoords.id}::uuid,   -- Ép kiểu thành uuid
//                     ST_GeomFromGeoJSON(${routeGeometryGeoJSON}), -- Chuyển GeoJSON thành PostGIS geometry
//                     ${duration},
//                     ${distance},
//                     NOW(),
//                     NOW()
//                 )
//                 ON CONFLICT ("startLocationId", "endLocationId") DO UPDATE
//                 SET path_geometry = ST_GeomFromGeoJSON(${routeGeometryGeoJSON}),
//                     duration_seconds = ${duration},
//                     distance_meters = ${distance},
//                     "updatedAt" = NOW();
//                 `
//             );
//             console.log(`[LocationTool] Saved route from "${startLocationName}" to "${endLocationName}" to DB.`);
//             console.log({
//                 durationSeconds: duration,
//                 distanceMeters: distance,
//                 formattedDuration: formattedDur,
//                 formattedDistance: formattedDist,
//                 mapUrl: mapUrl
//             });

//             return {
//                 durationSeconds: duration,
//                 distanceMeters: distance,
//                 formattedDuration: formattedDur,
//                 formattedDistance: formattedDist,
//                 mapUrl: mapUrl
//             };

//         }

//         return null; // Không tìm thấy đường đi nào thông qua OSRM API
//     } catch (error: any) {
//         console.error(`[LocationTool] Error getting route directions:`, error.message);
//         if (axios.isAxiosError(error) && error.response) {
//             console.error(`[LocationTool] OSRM API Error Response:`, error.response.data);
//         }
//         return null;
//     }
// }

export async function _findNearbyAdministrativeAreas(centerLocationName: string, maxResults: number = 5): Promise<string> {
    try {
        // Bước 1: Lấy tọa độ của địa điểm trung tâm
        const centerLocation = await getCoordinatesForLocation( centerLocationName );
        if (!centerLocation) {
            return `Không tìm thấy tọa độ cho địa điểm '${centerLocationName}'. Vui lòng cung cấp một địa điểm hợp lệ để tìm kiếm các khu vực hành chính lân cận.`;
        }

        const lat = centerLocation.latitude;
        const lon = centerLocation.longitude;

        console.log(`[LocationTool] Đang tìm các khu vực hành chính gần (${lat}, ${lon}).`);

        // Bước 2: Gọi Nominatim API để tìm các đối tượng hành chính lân cận
        // Chúng ta sẽ dùng endpoint /search với các bộ lọc để chỉ tìm các khu vực hành chính
        // và sử dụng lat/lon để ưu tiên kết quả gần nhất.
        const response = await axios.get(NOMINATIM_API_URL, {
            params: {
                q: 'tỉnh|thành phố|city|province', // Các từ khóa để tìm khu vực hành chính
                countrycodes: 'vn', // Chỉ tìm ở Việt Nam
                limit: 15, // Lấy nhiều hơn một chút để có thể lọc và sắp xếp
                format: 'json',
                addressdetails: 1, // Bao gồm chi tiết địa chỉ
                'accept-language': 'vi',
                lat: lat,
                lon: lon,
            },
            headers: {
                'User-Agent': 'LLM-Demo-App/1.0 (your-email@example.com)'
            }
        });

        let administrativeAreas = response.data.filter((place: any) =>
            (place.class === 'boundary' && (place.type === 'administrative' || place.type === 'city')) ||
            (place.type === 'state' || place.type === 'city') // Đối với các type khác nhau mà Nominatim có thể trả về
        );

        // Lọc bỏ chính địa điểm trung tâm nếu nó cũng là một khu vực hành chính
        administrativeAreas = administrativeAreas.filter((place: any) => 
            !place.display_name.includes(centerLocationName) && 
            !place.display_name.includes(centerLocation.displayName) // Loại trừ cả tên gốc và tên đã chuẩn hóa
        );

        // Sắp xếp các kết quả theo khoảng cách Euclidean thô (đơn giản)
        // Đây chỉ là một ước tính nhanh, không phải khoảng cách thực tế trên bề mặt Trái đất
        administrativeAreas.sort((a: any, b: any) => {
            const distA = Math.sqrt(Math.pow(a.lat - lat, 2) + Math.pow(a.lon - lon, 2));
            const distB = Math.sqrt(Math.pow(b.lat - lat, 2) + Math.pow(b.lon - lon, 2));
            return distA - distB;
        });

        // Chỉ lấy số lượng kết quả tối đa
        administrativeAreas = administrativeAreas.slice(0, maxResults);

        if (administrativeAreas && administrativeAreas.length > 0) {
            const summary = administrativeAreas.map((area: any, index: number) => {
                const name = area.name || area.display_name.split(',')[0].trim();
                const type = area.type === 'city' ? 'thành phố' : 'tỉnh'; // Hoặc loại khác nếu cần
                return `${index + 1}. **${name}** (${type})`;
            }).join('\n');
            return `Các ${administrativeAreas.length} tỉnh/thành phố gần nhất với **${centerLocationName}** là:\n${summary}`;
        } else {
            return `Không tìm thấy tỉnh/thành phố lân cận nào cho '${centerLocationName}'.`;
        }

    } catch (error: any) {
        console.error(`[LocationTool] Lỗi khi tìm các khu vực hành chính gần "${centerLocationName}":`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[LocationTool] Phản hồi lỗi từ Nominatim API khi tìm khu vực hành chính:`, error.response.data);
        }
        return `Có lỗi xảy ra khi tìm kiếm các tỉnh/thành phố lân cận ${centerLocationName}.`;
    }
}
function toRadians(degrees: number): number {
    return degrees * Math.PI / 180;
}

// Helper function để tính khoảng cách Haversine giữa hai điểm (lon/lat)
// Trả về khoảng cách bằng mét
function haversineDistance(coords1: [number, number], coords2: [number, number]): number {
    const R = 6371e3; // Bán kính Trái Đất bằng mét
    const lat1 = toRadians(coords1[1]); // vĩ độ điểm 1
    const lon1 = toRadians(coords1[0]); // kinh độ điểm 1
    const lat2 = toRadians(coords2[1]); // vĩ độ điểm 2
    const lon2 = toRadians(coords2[0]); // kinh độ điểm 2

    const deltaLat = lat2 - lat1;
    const deltaLon = lon2 - lon1;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Khoảng cách bằng mét
}

function buildOpenStreetMapsDirectionsUrl(
    routePoints: Array<{ latitude: number; longitude: number }>
): string {
    if (!routePoints || routePoints.length < 2) {
        console.warn("Không đủ điểm để tạo URL chỉ đường trên OpenStreetMap. Cần ít nhất 2 điểm.");
        return "";
    }

    // Chuyển đổi mỗi điểm {latitude, longitude} thành chuỗi "lat,lon" và mã hóa URL
    // Sau đó nối chúng lại bằng dấu chấm phẩy ";"
    // const routeString = routePoints.map(point => 
    //     `${point.latitude},${point.longitude}`
    // ).map(encodeURIComponent) // Mã hóa từng phần tử sau khi đã tạo chuỗi "lat,lon"
    // .join(';');
    const routeString = routePoints.map(point =>
        // Mã hóa từng phần tử (latitude và longitude) riêng lẻ
        // để đảm bảo các ký tự như dấu thập phân '.' được xử lý đúng cách nếu có vấn đề
        // Mặc dù với số học thường không cần thiết, đây là cách làm an toàn hơn.
        // Hoặc đơn giản là encodeURIComponent(`${point.latitude},${point.longitude}`)
        // như bạn đã làm, cũng thường hoạt động tốt.
        // Tôi sẽ giữ lại cách của bạn vì nó ngắn gọn và hoạt động.
        encodeURIComponent(`${point.latitude},${point.longitude}`)
    ).join(';');

    // OpenStreetMap.org sử dụng tham số 'route' với các điểm được nối bằng ';'.
    // 'engine=osrm_car' là tùy chọn để chỉ định công cụ định tuyến (phù hợp vì OSRM được dùng để tính toán)
    const url = `https://www.openstreetmap.org/directions?engine=osrm_car&route=${routeString}`;
    
    return url;
}

export async function getDetailsRouteDirections(
        startLocationName?: string,
        startLatitude?: number,
        startLongitude?: number,
        endLocationName?: string,
        endLatitude?: number,
        endLongitude?: number,
        waypoints?: Array<string | { latitude: number; longitude: number }>

): Promise<{
    durationSeconds: number; // Thời gian gốc bằng giây
    distanceMeters: number;  // Khoảng cách gốc bằng mét
    formattedDuration: string; // Thời gian đã định dạng
    formattedDistance: string; // Khoảng cách đã định dạng
    mapUrl: string; // URL bản đồ
    routePoints: Array<{ latitude: number; longitude: number; }>; // Các điểm tọa độ trên đường đi

} | null> {

    try {
        let startCoords: { id: string; latitude: number; longitude: number; displayName: string } | null = null;
        let endCoords: { id: string; latitude: number; longitude: number; displayName: string } | null = null;
        let allCoordinates: { id: string; latitude: number; longitude: number; displayName: string }[] = [];

        // Bước 1: Lấy tọa độ và ID của địa điểm bắt đầu và kết thúc
        if (startLocationName ) {
             startCoords = await getCoordinatesForLocation(startLocationName);
        }else if (startLatitude !== undefined && startLongitude !== undefined) {
            const detailedAddress = await _getDetailedAddress(startLatitude, startLongitude);
            console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${detailedAddress}"`);

             startCoords = await getCoordinatesForLocation( detailedAddress);
            console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${startCoords}"`);
            if (!startCoords) {
                // Nếu không tìm thấy tọa độ với địa chỉ chi tiết đã xử lý, thử với phiên bản đơn giản hơn (fallback)
                console.warn(`[LocationTool] Failed to get coordinates for processed detailed start address. Attempting simpler address.`);
                const parts = detailedAddress.split(',').map(part => part.trim());
                let simplerAddress = '';

                if (parts.length >= 5) {
                    const district = parts[parts.length - 4];
                    const city = parts[parts.length - 3];
                    simplerAddress = `${district}, ${city}`;
                } else if (parts.length >= 2) {
                    const city = parts[parts.length - 2];
                    const country = parts[parts.length - 1];
                    simplerAddress = `${city}, ${country}`;
                }

                if (simplerAddress) {
                    console.warn(`[LocationTool] Trying simpler start address: "${simplerAddress}"`);
                    startCoords = await getCoordinatesForLocation(simplerAddress);
                }
            }

        }
        if (!startCoords) {
            console.warn(`[LocationTool] Could not get valid coordinates for start location. Cannot calculate route.`);
            return null;
        }
        allCoordinates.push(startCoords);

        if (waypoints && waypoints.length > 0) {
            for (const wp of waypoints) {
                let wpCoords: { id: string; latitude: number; longitude: number; displayName: string } | null = null;
                if (typeof wp === 'string') {
                    wpCoords = await getCoordinatesForLocation(wp);
                } else { // Assuming { latitude: number; longitude: number }
                    const detailedAddress = await _getDetailedAddress(wp.latitude, wp.longitude);
                    wpCoords = await getCoordinatesForLocation(detailedAddress);
                    if (!wpCoords) {
                        const parts = detailedAddress.split(',').map(part => part.trim());
                        let simplerAddress = '';
                        if (parts.length >= 5) {
                            const district = parts[parts.length - 4];
                            const city = parts[parts.length - 3];
                            simplerAddress = `${district}, ${city}`;
                        } else if (parts.length >= 2) {
                            const city = parts[parts.length - 2];
                            const country = parts[parts.length - 1];
                            simplerAddress = `${city}, ${country}`;
                        }
                        if (simplerAddress) {
                            wpCoords = await getCoordinatesForLocation(simplerAddress);
                        }
                    }
                }
                if (wpCoords) {
                    allCoordinates.push(wpCoords);
                } else {
                    console.warn(`[LocationTool] Could not get coordinates for waypoint: ${JSON.stringify(wp)}. Skipping.`);
                }
            }
        }

        if (endLocationName ) {
             endCoords = await getCoordinatesForLocation(endLocationName);
        }else if (endLatitude !== undefined && endLongitude !== undefined) {
            const detailedAddress = await _getDetailedAddress(endLatitude, endLongitude);
            console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${detailedAddress}"`);

             endCoords =  await getCoordinatesForLocation( await _getDetailedAddress(endLatitude, endLongitude));
                         console.log(`[LocationTool] Trying to get coordinates for detailed start address: "${detailedAddress}"`);
            if (!endCoords) {
                // Nếu không tìm thấy tọa độ với địa chỉ chi tiết đã xử lý, thử với phiên bản đơn giản hơn (fallback)
                console.warn(`[LocationTool] Failed to get coordinates for processed detailed end address. Attempting simpler address.`);
                const parts = detailedAddress.split(',').map(part => part.trim());
                let simplerAddress = '';

                if (parts.length >= 5) {
                    const district = parts[parts.length - 4];
                    const city = parts[parts.length - 3];
                    simplerAddress = `${district}, ${city}`;
                } else if (parts.length >= 2) {
                    const city = parts[parts.length - 2];
                    const country = parts[parts.length - 1];
                    simplerAddress = `${city}, ${country}`;
                }

                if (simplerAddress) {
                    console.warn(`[LocationTool] Trying simpler end address: "${simplerAddress}"`);
                    endCoords = await getCoordinatesForLocation(simplerAddress);
                }
            }

        }
          if (!endCoords) {
            console.warn(`[LocationTool] Could not get valid coordinates for end location. Cannot calculate route.`);
            return null;
        }
        allCoordinates.push(endCoords);
        if (allCoordinates.length < 2) {
            console.warn(`[LocationTool] Not enough valid locations (start, waypoints, end) to calculate a route.`);
            return null;
        }
        const coordinateString = allCoordinates.map(coord => `${coord.longitude},${coord.latitude}`).join(';');
        console.log(`[LocationTool] Calling OSRM API for route with coordinates: ${coordinateString}`);


        // Try to retrieve from DB first (only for direct A-B or A-B with 1 waypoint for simplicity here,
        // more complex logic needed for full multi-waypoint caching)
        // For multi-waypoint, caching can be more complex, potentially by hashing the ordered list of location IDs.
        // For simplicity in this example, we'll always call OSRM for multi-waypoint routes.
        if (allCoordinates.length === 2) {
            const existingRoute = await prisma.$queryRaw<Array<{
                duration_seconds: number;
                distance_meters: number;
                path_geometry_geojson: string; // Retrieve as string to parse
            }>>(
                Prisma.sql`
                SELECT
                    duration_seconds,
                    distance_meters,
                    ST_AsGeoJSON(path_geometry) AS path_geometry_geojson
                FROM "RouteData"
                WHERE "startLocationId" = ${allCoordinates[0].id}::uuid
                AND "endLocationId" = ${allCoordinates[1].id}::uuid
                LIMIT 1;
                `
            );

            if (existingRoute && existingRoute.length > 0) {
                const routeData = existingRoute[0];
                console.log(`[LocationTool] Found cached direct route in DB.`);
                const formattedDur = formatDuration(routeData.duration_seconds);
                const formattedDist = formatDistance(routeData.distance_meters);

                // Parse the GeoJSON string back into an object
                const geometry = JSON.parse(routeData.path_geometry_geojson);
                const routePoints: Array<{ latitude: number; longitude: number }> = geometry.coordinates.map((coord: [number, number]) => ({
                    longitude: coord[0],
                    latitude: coord[1],
                }));

                const mapUrl = buildOpenStreetMapsDirectionsUrl(routePoints);
                
                return {
                    durationSeconds: routeData.duration_seconds,
                    distanceMeters: routeData.distance_meters,
                    formattedDuration: formattedDur,
                    formattedDistance: formattedDist,
                    mapUrl: mapUrl,
                    routePoints: routePoints,
                };
            }
        }


        
        // const startId: string = startCoords.id;
        // const endId: string = endCoords.id;
        // const waypointLocationIds: string[] = []; // Lưu trữ IDs của waypoints
        // const osrmWaypointCoords: { latitude: number; longitude: number }[] = []; // Lưu trữ tọa độ cho chuỗi OSRM API

        // const rawExistingRoutes = await prisma.$queryRaw<{
        //     duration_seconds: number;
        //     distance_meters: number;
        //     path_geometry: string;
        // }[]>(Prisma.sql`
        //     SELECT
        //         duration_seconds,
        //         distance_meters,
        //         ST_AsGeoJSON(path_geometry) AS path_geometry
        //     FROM "RouteData"
        //     WHERE "startLocationId" = ${startId} AND "endLocationId" = ${endId}
        //     LIMIT 1;
        // `);
        // const existingRoute = rawExistingRoutes[0]; // Lấy phần tử đầu tiên nếu có

        // // Bước 2: Kiểm tra trong database PostGIS (bảng RouteData)
        // const existingRoute = await prisma.routeData.findUnique({
        //     where: {
        //         UniqueRoute: { // Tên của unique constraint đã định nghĩa trong schema.prisma
        //             startLocationId: startCoords.id,
        //             endLocationId: endCoords.id,
        //         }
        //     }
        // });

        console.log(`[LocationTool] Calling OSRM API for route from "${startLocationName}" to "${endLocationName}"...`);

        // Bước 3: Gọi OSRM API nếu không có trong DB
        const response = await axios.get(`${OSRM_API_URL}/${coordinateString}`, {
            params: {
                alternatives: false,
                steps: true,
                geometries: 'geojson',
                overview: 'full'
            }
        });

        if (response.data && response.data.routes && response.data.routes.length > 0) {
            const route = response.data.routes[0];
            const duration = route.duration;
            const distance = route.distance;
            const routeGeometryGeoJSON = JSON.stringify(route.geometry);
            const formattedDur = formatDuration(duration);
            const formattedDist = formatDistance(distance);

            const routePoints: Array<{ latitude: number; longitude: number }> = route.geometry.coordinates.map((coord: [number, number]) => ({
                longitude: coord[0],
                latitude: coord[1],
            }));
            const pathCoords = route.geometry.coordinates;
            const originalWaypoints: Array<{ latitude: number; longitude: number }> = allCoordinates.map(coord => ({
                latitude: coord.latitude,
                longitude: coord.longitude
            }));

                        // --- Lấy mẫu các điểm trên đường đi từ OSRM (Giữ nguyên) ---
            const SAMPLE_INTERVAL_METERS = 1000; // 10 km
            const sampledRoutePoints: Array<{ latitude: number; longitude: number; }> = [];
            let currentDistance = 0;

            if (pathCoords.length > 0) {
                sampledRoutePoints.push({ latitude: pathCoords[0][1], longitude: pathCoords[0][0] });
            }
            for (let i = 0; i < pathCoords.length - 1; i++) {
                const point1 = pathCoords[i];
                const point2 = pathCoords[i + 1];

                const segmentDistance = haversineDistance(point1, point2);
                currentDistance += segmentDistance;

                if (currentDistance >= SAMPLE_INTERVAL_METERS) {
                    sampledRoutePoints.push({ latitude: point2[1], longitude: point2[0] });
                    currentDistance = 0;
                }
            }
            if (pathCoords.length > 0) {
                const lastPoint = pathCoords[pathCoords.length - 1];
                const lastSampledPoint = sampledRoutePoints[sampledRoutePoints.length - 1];
                if (lastSampledPoint.latitude !== lastPoint[1] || lastSampledPoint.longitude !== lastPoint[0]) {
                    sampledRoutePoints.push({ latitude: lastPoint[1], longitude: lastPoint[0] });
                }
            }

            const mapUrl = buildOpenStreetMapsDirectionsUrl(allCoordinates);
            console.log(mapUrl);
            // Store the route data and waypoints in the database
            if (allCoordinates.length === 2) {
                await prisma.$executeRaw(
                    Prisma.sql`
                    INSERT INTO "RouteData" (id, "startLocationId", "endLocationId", path_geometry, duration_seconds, distance_meters, "createdAt", "updatedAt")
                    VALUES (
                        gen_random_uuid(),
                        ${startCoords!.id}::uuid, // Use startCoords and endCoords from the allCoordinates array if available
                        ${endCoords!.id}::uuid,
                        ST_GeomFromGeoJSON(${routeGeometryGeoJSON}),
                        ${duration},
                        ${distance},
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT ("startLocationId", "endLocationId") DO UPDATE
                    SET path_geometry = ST_GeomFromGeoJSON(${routeGeometryGeoJSON}),
                        duration_seconds = ${duration},
                        distance_meters = ${distance},
                        "updatedAt" = NOW();
                    `
                );
                console.log(`[LocationTool] Saved direct route to DB.`);
            } else if (allCoordinates.length > 2) {
                                // let newRouteId: string;

                // For multi-waypoint routes, you might want to create a new RouteData entry
                // and then associate each waypoint with it in the RouteWaypoint table.
                // This requires a new routeId.
                const newRouteId = (await prisma.$queryRaw<{ id: string }[]>(
                    Prisma.sql`SELECT gen_random_uuid() AS id;`
                ))[0].id; // Generate a new UUID for the route
                // newRouteId = uuidv4(); // Make sure you have 'uuid' package installed: npm install uuid @types/uuid

                await prisma.$executeRaw(
                    Prisma.sql`
                    INSERT INTO "RouteData" (id, "startLocationId", "endLocationId", path_geometry, duration_seconds, distance_meters, "createdAt", "updatedAt")
                    VALUES (
                        ${newRouteId}::uuid,
                        ${startCoords!.id}::uuid,
                        ${endCoords!.id}::uuid,
                        ST_GeomFromGeoJSON(${routeGeometryGeoJSON}),
                        ${duration},
                        ${distance},
                        NOW(),
                        NOW()
                    )    
                    ;
                    `
                );
                console.log(`[LocationTool] Saved multi-waypoint route in RouteData with ID: ${newRouteId}.`);

                // Save waypoints to RouteWaypoint table
                for (let i = 0; i < allCoordinates.length; i++) {
                    await prisma.$executeRaw(
                        Prisma.sql`
                        INSERT INTO "RouteWaypoint" (id, "routeId", "locationId", "order", "createdAt", "updatedAt")
                        VALUES (
                            gen_random_uuid(),
                            ${newRouteId}::uuid,
                            ${allCoordinates[i].id}::uuid,
                            ${i},
                            NOW(),
                            NOW()
                        )
                        ON CONFLICT ("routeId", "locationId") DO UPDATE
                        SET "order" = ${i}, "updatedAt" = NOW();
                        `
                    );
                }
                console.log(`[LocationTool] Saved waypoints for route ID: ${newRouteId}.`);
            }

            console.log({
                durationSeconds: duration,
                distanceMeters: distance,
                formattedDuration: formattedDur,
                formattedDistance: formattedDist,
                mapUrl: mapUrl,
                routePoints: sampledRoutePoints,
            });

            return {
                durationSeconds: duration,
                distanceMeters: distance,
                formattedDuration: formattedDur,
                formattedDistance: formattedDist,
                mapUrl: mapUrl,
                routePoints: sampledRoutePoints,
            };

        }


        // if (response.data && response.data.routes && response.data.routes.length > 0) {
        //     const route = response.data.routes[0];
        //     const duration = route.duration;
        //     const distance = route.distance;
        //     const routeGeometryGeoJSON = JSON.stringify(route.geometry);

        //     const routePoints: Array<{ latitude: number; longitude: number }> = route.geometry.coordinates.map((coord: [number, number]) => ({
        //         longitude: coord[0],
        //         latitude: coord[1],
        //     }));

        //     // --- Lấy mẫu các điểm trên đường đi từ OSRM (Giữ nguyên) ---
        //     const SAMPLE_INTERVAL_METERS = 1000; // 10 km
        //     const sampledRoutePoints: Array<{ latitude: number; longitude: number; }> = [];
        //     let currentDistance = 0;

        //     if (pathCoords.length > 0) {
        //         sampledRoutePoints.push({ latitude: pathCoords[0][1], longitude: pathCoords[0][0] });
        //     }
        //     for (let i = 0; i < pathCoords.length - 1; i++) {
        //         const point1 = pathCoords[i];
        //         const point2 = pathCoords[i + 1];

        //         const segmentDistance = haversineDistance(point1, point2);
        //         currentDistance += segmentDistance;

        //         if (currentDistance >= SAMPLE_INTERVAL_METERS) {
        //             sampledRoutePoints.push({ latitude: point2[1], longitude: point2[0] });
        //             currentDistance = 0;
        //         }
        //     }
        //     if (pathCoords.length > 0) {
        //         const lastPoint = pathCoords[pathCoords.length - 1];
        //         const lastSampledPoint = sampledRoutePoints[sampledRoutePoints.length - 1];
        //         if (lastSampledPoint.latitude !== lastPoint[1] || lastSampledPoint.longitude !== lastPoint[0]) {
        //             sampledRoutePoints.push({ latitude: lastPoint[1], longitude: lastPoint[0] });
        //         }
        //     }


        //     const formattedDur = formatDuration(duration);
        //     const formattedDist = formatDistance(distance);
        //     const mapUrl = buildGoogleMapsDirectionsUrl(
        //         startCoords.latitude, startCoords.longitude,
        //         endCoords.latitude, endCoords.longitude
        //     );

        //     // Bước 4: Lưu thông tin tuyến đường vào database PostGIS
        //     // Chèn GeoJSON LineString vào cột path_geometry
        //     await prisma.$executeRaw(
        //         Prisma.sql`
        //         INSERT INTO "RouteData" (id, "startLocationId", "endLocationId", path_geometry, duration_seconds, distance_meters, "createdAt", "updatedAt")
        //         VALUES (
        //             gen_random_uuid(),
        //             ${startCoords.id}::uuid, -- Ép kiểu thành uuid
        //             ${endCoords.id}::uuid,   -- Ép kiểu thành uuid
        //             ST_GeomFromGeoJSON(${routeGeometryGeoJSON}), -- Chuyển GeoJSON thành PostGIS geometry
        //             ${duration},
        //             ${distance},
        //             NOW(),
        //             NOW()
        //         )
        //         ON CONFLICT ("startLocationId", "endLocationId") DO UPDATE
        //         SET path_geometry = ST_GeomFromGeoJSON(${routeGeometryGeoJSON}),
        //             duration_seconds = ${duration},
        //             distance_meters = ${distance},
        //             "updatedAt" = NOW();
        //         `
        //     );
        //     console.log(`[LocationTool] Saved route from "${startLocationName}" to "${endLocationName}" to DB.`);
        //     console.log({
        //         durationSeconds: duration,
        //         distanceMeters: distance,
        //         formattedDuration: formattedDur,
        //         formattedDistance: formattedDist,
        //         mapUrl: mapUrl,
        //         routePoints: sampledRoutePoints

        //     });

        //     return {
        //         durationSeconds: duration,
        //         distanceMeters: distance,
        //         formattedDuration: formattedDur,
        //         formattedDistance: formattedDist,
        //         mapUrl: mapUrl,
        //         routePoints: sampledRoutePoints

        //     };

        // }

        return null; // Không tìm thấy đường đi nào thông qua OSRM API
    } catch (error: any) {
        console.error(`[LocationTool] Error getting route directions:`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[LocationTool] OSRM API Error Response:`, error.response.data);
            if (error.response.status === 400 && error.response.data.code === 'InvalidUrl') {
                console.error("[LocationTool] OSRM Error: One or more locations/waypoints could not be routed. This might be due to invalid coordinates or unroutable areas.");
            }
        }
        return null;
    }

}

interface GetRouteDirectionsInput {
    startLocationName?: string;
    startLatitude?: number;
    startLongitude?: number;
    endLocationName?: string;
    endLatitude?: number;
    endLongitude?: number;
    waypoints?: Array<string | { latitude: number; longitude: number }>;
}

export async function searchPlacesWithNominatim(
  query: string,
  latitude?: number,
  longitude?: number,
  radius?: number // Nominatim thường không dùng radius trực tiếp cho tìm kiếm, mà dùng bounding box hoặc vị trí ưu tiên.
): Promise<string> {
  // Base URL của Nominatim API
  const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

  try {
    const params: any = {
      q: query,
      format: "json",
      addressdetails: 1, // Bao gồm chi tiết địa chỉ
      limit: 5, // Giới hạn 5 kết quả
      // Để ưu tiên kết quả gần vị trí hiện tại:
      // Thêm 'viewbox' hoặc 'bounded' để giới hạn khu vực tìm kiếm, hoặc 'dedupe=0'
      // Để tìm kiếm theo tọa độ, bạn có thể thêm 'lat' và 'lon' để ưu tiên
      ...(latitude && longitude && {
        lat: latitude,
        lon: longitude,
        // Zoom mặc định cho tìm kiếm địa điểm, có thể tùy chỉnh
        zoom: 17, 
      }),
      // Nếu bạn muốn tìm kiếm trong một bán kính cụ thể, Nominatim không có tham số `radius` trực tiếp
      // Bạn sẽ cần tính toán một 'viewbox' (hộp giới hạn) dựa trên tọa độ và bán kính.
      // Ví dụ đơn giản nếu muốn ưu tiên gần một điểm:
      // 'extratags': 1, 'namedetails': 1
    };

    console.log("Đang gọi Nominatim với params:", params);

    const response = await axios.get(NOMINATIM_URL, { params });
    const results = response.data;

    if (results && results.length > 0) {
      const formattedResults = results
        .map((place: any) => {
          const name = place.namedetails?.name || place.display_name;
          const address = place.display_name;
          const lat = place.lat;
          const lon = place.lon;
          // Loại bỏ các kết quả quá chung chung như chỉ tên quốc gia hoặc bang
          if (place.osm_type === "relation" && (place.type === "country" || place.type === "state")) {
              return null; // Bỏ qua kết quả này
          }
          return `- ${name} (${place.type || 'Địa điểm'}): ${address} (Tọa độ: ${lat}, ${lon})`;
        })
        .filter(Boolean) // Loại bỏ các kết quả null
        .join("\n");
      
      if (formattedResults) {
        return `Tôi tìm thấy một số ${query} gần đó:\n${formattedResults}`;
      } else {
        return `Xin lỗi, tôi không tìm thấy ${query} nào phù hợp gần vị trí bạn.`;
      }
    } else {
      return `Xin lỗi, tôi không tìm thấy ${query} nào gần vị trí bạn. Vui lòng thử một truy vấn khác hoặc kiểm tra lại khu vực.`;
    }
  } catch (error) {
    console.error("Lỗi khi gọi Nominatim API:", error);
    // Xử lý lỗi từ Nominatim (ví dụ: giới hạn tốc độ, lỗi mạng)
    return `Xin lỗi, tôi gặp sự cố khi tìm kiếm địa điểm bằng Nominatim. Vui lòng thử lại sau. (Lỗi: ${(error as any).message})`;
  }
}

export async function getGeographyInfoWithNominatim(locationName: string): Promise<string> {
    const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

    try {
        const params = {
            q: locationName,
            format: "json",
            addressdetails: 1, // Bao gồm chi tiết địa chỉ
            limit: 1, // Chỉ lấy 1 kết quả phù hợp nhất
            extratags: 1, // Lấy thêm các tags bổ sung
            namedetails: 1, // Lấy thêm tên chi tiết
        };

        console.log(`Đang tìm kiếm thông tin địa lý cho "${locationName}" bằng Nominatim...`);

        const response = await axios.get(NOMINATIM_URL, { params });
        const results = response.data;

        if (results && results.length > 0) {
            const place = results[0]; // Lấy kết quả đầu tiên (phù hợp nhất)

            let info = `Thông tin về ${place.display_name}:\n`;
            info += `  - Tọa độ: Vĩ độ ${place.lat}, Kinh độ ${place.lon}\n`;
            info += `  - Loại địa điểm: ${place.type || 'Không rõ'}\n`;
            info += `  - Cấp độ OSM: ${place.osm_type || 'Không rõ'}\n`;

            if (place.address) {
                if (place.address.country) {
                    info += `  - Quốc gia: ${place.address.country}\n`;
                }
                if (place.address.state) {
                    info += `  - Bang/Tỉnh: ${place.address.state}\n`;
                }
                if (place.address.city || place.address.town || place.address.village) {
                    info += `  - Thành phố/Thị trấn: ${place.address.city || place.address.town || place.address.village}\n`;
                }
                if (place.address.road) {
                    info += `  - Đường: ${place.address.road}\n`;
                }
            }

            if (place.namedetails && Object.keys(place.namedetails).length > 0) {
                const nativeName = place.namedetails[`name:vi`] || place.namedetails.name;
                if (nativeName && nativeName !== place.display_name) {
                    info += `  - Tên địa phương: ${nativeName}\n`;
                }
            }
            
            // Một số địa điểm nổi tiếng có thể có tag wikipedia
            if (place.extratags?.wikipedia) {
                info += `  - Wikipedia: https://vi.wikipedia.org/wiki/${place.extratags.wikipedia.replace(/ /g, '_')}\n`;
            }

            return info;

        } else {
            return `Xin lỗi, tôi không tìm thấy thông tin địa lý cho "${locationName}". Vui lòng kiểm tra lại tên địa danh hoặc thử một địa danh khác.`;
        }
    } catch (error) {
        console.error("Lỗi khi gọi Nominatim API cho thông tin địa lý:", error);
        return `Xin lỗi, tôi gặp sự cố khi tìm kiếm thông tin địa lý cho "${locationName}". Vui lòng thử lại sau. (Lỗi: ${(error as any).message})`;
    }
}
const OPENROUTESERVICE_API_KEY = process.env.OPENROUTESERVICE_API_KEY;


export async function getOpenrouteserviceDirections(
    startLocationName: string,
    endLocationName: string
): Promise<string> {
    if (!OPENROUTESERVICE_API_KEY || OPENROUTESERVICE_API_KEY === "YOUR_OPENROUTESERVICE_API_KEY") {
        return "Lỗi: Không tìm thấy Openrouteservice API Key. Vui lòng cung cấp khóa API hợp lệ.";
    }

    // Bước 1: Lấy tọa độ cho điểm xuất phát
    const startCoordsResult = await getCoordinatesForLocation(startLocationName);
    let startLat: number, startLon: number;
        const parsedStartCoords = startCoordsResult;
        if(parsedStartCoords === null) {
            return "Không tìm thấy tọa độ cho địa điểm xuất phát. Vui lòng kiểm tra lại tên địa điểm hoặc thử lại sau.";
        }
        if (parsedStartCoords.latitude && parsedStartCoords.longitude) {
            startLat = parsedStartCoords.latitude;
            startLon = parsedStartCoords.longitude;
        } else {
            return `Không tìm thấy tọa độ cho địa điểm xuất phát: "${startLocationName}". Vui lòng thử lại với tên địa điểm chính xác hơn.`;
        }


    // Bước 2: Lấy tọa độ cho điểm đích
    const parsedEndCoords = await getCoordinatesForLocation(endLocationName);
    let endLat: number, endLon: number;
        if(parsedEndCoords === null) {
            return "Không tìm thấy tọa độ cho địa điểm đích. Vui lòng kiểm tra lại tên địa điểm hoặc thử lại sau.";
        }
        if (parsedEndCoords.latitude && parsedEndCoords.longitude) {
            endLat = parsedEndCoords.latitude;
            endLon = parsedEndCoords.longitude;
        } else {
            return `Không tìm thấy tọa độ cho địa điểm đích: "${endLocationName}". Vui lòng thử lại với tên địa điểm chính xác hơn.`;
        }

    // URL của Openrouteservice Directions API (chế độ lái xe)
    const ORS_DIRECTIONS_URL = "https://api.openrouteservice.org/v2/directions/driving-car";

    try {
        console.log(`Đang tính toán lộ trình từ ${startLocationName} đến ${endLocationName} bằng Openrouteservice...`);
        const response = await axios.get(ORS_DIRECTIONS_URL, {
            params: {
                api_key: OPENROUTESERVICE_API_KEY,
                start: `${startLon},${startLat}`,
                end: `${endLon},${endLat}`,
                // Các tham số khác để lấy chi tiết:
                instructions: true, // Bao gồm các bước chỉ dẫn
                instructions_format: "text", // Định dạng văn bản cho chỉ dẫn
                geometry: false, // Không cần hình học đường đi nếu chỉ muốn chỉ dẫn
                language: "vi", // Ngôn ngữ tiếng Việt
                alternatives: true, 

            },
        });

        const data = response.data;

        if (data.features && data.features.length > 0) {
            let allRoutesSummary = `Tôi đã tìm thấy ${data.features.length} lộ trình khả dụng từ ${startLocationName} đến ${endLocationName}:\n\n`;
                        data.features.forEach((route: any, index: number) => {
                const summary = route.properties.summary;
                const segments = route.properties.segments;

                const totalDistance = (summary.distance / 1000).toFixed(2); // km
                const totalDuration = summary.duration / 60; // phút

                allRoutesSummary += `--- Lộ trình ${index + 1} ---\n`;
                allRoutesSummary += `Tổng khoảng cách: **${totalDistance} km**\n`;
                allRoutesSummary += `Thời gian di chuyển ước tính: **${totalDuration} phút**\n`;
                
                // === PHÂN TÍCH ƯU & NHƯỢC ĐIỂM (CÓ GIỚI HẠN) ===
                let prosCons = [];
                if (index === 0) { // Thường lộ trình đầu tiên là tối ưu nhất về thời gian/khoảng cách
                    prosCons.push("Đây là lộ trình được đề xuất tối ưu nhất.");
                } else if (totalDuration > (data.features[0].properties.summary.duration / 60) + 5) { // Nếu dài hơn đáng kể
                    prosCons.push("Lộ trình này dài hơn và có thể mất nhiều thời gian hơn so với tuyến nhanh nhất.");
                }
                
                // Bạn có thể thêm các logic phức tạp hơn ở đây nếu Openrouteservice cung cấp dữ liệu chi tiết hơn.
                // Ví dụ: dựa trên số lượng bước rẽ (step.length) để ước tính "ít đèn đỏ" hoặc "nhiều ngã rẽ".
                // Tuy nhiên, thông tin về "tắc đường giờ cao điểm" hoặc "số đèn đỏ cụ thể" thường KHÔNG có sẵn trực tiếp từ API định tuyến cơ bản.
                
                if (prosCons.length > 0) {
                    allRoutesSummary += `Ưu/Nhược điểm: ${prosCons.join(" ")}\n`;
                }
                
                allRoutesSummary += `Chi tiết các bước:\n`;
                if (segments && segments.length > 0) {
                    segments.forEach((segment: any) => {
                        segment.steps.forEach((step: any, stepIndex: number) => {
                            allRoutesSummary += `${stepIndex + 1}. ${step.instruction} (${(step.distance / 1000).toFixed(2)} km)\n`;
                        });
                    });
                } else {
                    allRoutesSummary += "Không có chi tiết các bước đi cho lộ trình này.";
                }
                allRoutesSummary += "\n";
            });
            return allRoutesSummary;

            // const route = data.features[0];
            // const summary = route.properties.summary;
            // const segments = route.properties.segments;

            // const totalDistance = (summary.distance / 1000).toFixed(2); // km
            // const totalDuration = (summary.duration / 60).toFixed(0); // phút

            // let routeDetails = `Lộ trình từ ${startLocationName} đến ${endLocationName}:\n`;
            // routeDetails += `Tổng khoảng cách: ${totalDistance} km\n`;
            // routeDetails += `Thời gian di chuyển ước tính: ${totalDuration} phút\n\n`;
            // routeDetails += `Chi tiết các bước:\n`;

            // if (segments && segments.length > 0) {
            //     segments.forEach((segment: any) => {
            //         segment.steps.forEach((step: any, index: number) => {
            //             routeDetails += `${index + 1}. ${step.instruction} (${(step.distance / 1000).toFixed(2)} km)\n`;
            //         });
            //     });
            // } else {
            //     routeDetails += "Không có chi tiết các bước đi.";
            // }

            // return routeDetails;

        } else {
            return `Không thể tìm thấy lộ trình từ ${startLocationName} đến ${endLocationName}. Vui lòng kiểm tra lại tên địa điểm hoặc thử lại sau.`;
        }

    } catch (error) {
        console.error("Lỗi khi gọi Openrouteservice API:", error);
        if (axios.isAxiosError(error) && error.response) {
            // Log chi tiết lỗi từ API để dễ debug
            console.error("Openrouteservice API Error Response:", error.response.data);
            return `Xin lỗi, tôi gặp sự cố khi tính toán lộ trình. Lỗi từ Openrouteservice: ${error.response.status} - ${error.response.data.error?.message || 'Không rõ lỗi'}. Vui lòng kiểm tra API Key và tên địa điểm.`;
        }
        return `Xin lỗi, tôi gặp sự cố khi tính toán lộ trình từ ${startLocationName} đến ${endLocationName}. Vui lòng thử lại sau.`;
    }
}


//-------------------------------------------------------------------------------

// export const getRouteDirectionsTool = new DynamicStructuredTool({
//     name: "getRouteDirections",
//     description: "Lấy thông tin tuyến đường (thời gian tính bằng giây, khoảng cách tính bằng mét) giữa hai địa điểm được chỉ định. Nó kiểm tra database để tìm tuyến đường đã lưu trữ trước, và nếu không tìm thấy, nó sẽ tính toán tuyến đường bằng cách sử dụng OSRM API (OpenStreetMap Routing Machine) và lưu trữ. Trả về khoảng cách, thời gian và các bước hướng dẫn cụ thể. Có thể chấp nhận tên địa điểm hoặc cặp tọa độ (vĩ độ, kinh độ).",
//     schema: {
//         type: "object",
//         properties: {
//             startLocationName: {
//                 type: "string",
//                 description: "Tên của địa điểm bắt đầu cho tuyến đường (ví dụ: 'Hà Nội', 'Quận 1, TP.HCM')."
//             },
//             startLatitude: { // New property
//                 type: "number",
//                 description: "Vĩ độ của điểm bắt đầu (ví dụ: 21.0272256)."
//             },
//             startLongitude: { // New property
//                 type: "number",
//                 description: "Kinh độ của điểm bắt đầu (ví dụ: 105.7783808)."
//             },
//             endLocationName: {
//                 type: "string",
//                 description: "Tên của địa điểm đích cho tuyến đường (ví dụ: 'Thành phố Hồ Chí Minh', 'Sân bay Nội Bài')."
//             },
//             endLatitude: { // New property
//                 type: "number",
//                 description: "Vĩ độ của điểm đích (ví dụ: 21.0272256)."
//             },
//             endLongitude: { // New property
//                 type: "number",
//                 description: "Kinh độ của điểm đích (ví dụ: 105.7783808)."
//             }
//         },
//         // Make sure to adjust 'required' based on whether coordinates or names are needed
//         required: ["endLocationName"] // Or adjust as needed for start/end
//     } as const,
//     func: async (input: {
//         startLocationName?: string;
//         startLatitude?: number;
//         startLongitude?: number;
//         endLocationName?: string;
//         endLatitude?: number;
//         endLongitude?: number;
//     }) => {
//         // Your existing logic would need to be updated to handle
//         // either startLocationName OR (startLatitude, startLongitude)
//         // and similarly for the end location.
//         // You'd need to prioritize which input to use if both are provided.
//         // You'd then pass 'startLocation' and 'endLocation' to your getRouteDirections function,
//         // which would need to handle both string names and coordinate objects.
//         const result = await getRouteDirections(input.startLocationName, input.startLatitude, input.startLongitude, input.endLocationName, input.endLatitude, input.endLongitude); // getRouteDirections needs to be updated
//         if (result) {
//             return {
//                 success: true,
//                 startLocationName: input.startLocationName || `${input.startLatitude}, ${input.startLongitude}`, // Or a reverse geocoded name
//                 endLocationName: input.endLocationName || `${input.endLatitude}, ${input.endLongitude}`,
//                 durationSeconds: result.durationSeconds,
//                 distanceMeters: result.distanceMeters,
//                 formattedDuration: result.formattedDuration,
//                 formattedDistance: result.formattedDistance,
//                 mapUrl: result.mapUrl,
//             };
//         } else {
//             return {
//                 success: false,
//                 message: "Không thể tìm thấy tuyến đường hoặc có lỗi xảy ra."
//             };
//         }
//     },
// });

// Khởi tạo DynamicStructuredTool với JSON Schema cho việc lấy tọa độ
export const getCoordinatesTool = new DynamicStructuredTool({
    name: "getCoordinatesForLocation",
    description: "Lấy tọa độ địa lý (vĩ độ, kinh độ) và ID duy nhất cho một tên địa điểm. Nó ưu tiên kiểm tra database để tìm dữ liệu đã lưu trữ trước, và nếu không tìm thấy, nó sẽ sử dụng API OpenStreetMap Nominatim để tìm và lưu trữ địa điểm. Trả về tọa độ hoặc thông báo không tìm thấy.",
    schema: {
        type: "object",
        properties: {
            locationName: {
                type: "string",
                description: "Tên của địa điểm (ví dụ: 'Hà Nội', 'Thành phố Hồ Chí Minh', 'London', 'Paris')."
            }
        },
        required: ["locationName"],
    } as const,
    func: async (input: { locationName: string }) => {
        const result = await getCoordinatesForLocation(input.locationName);
        if (result) {
            return `Tọa độ của ${input.locationName} là Vĩ độ: ${result.latitude}, Kinh độ: ${result.longitude}. (ID: ${result.id})`;
        } else {
            return `Không tìm thấy tọa độ cho địa điểm '${input.locationName}'.`;
        }
    },
});

export const findNearbyAdministrativeAreasTool = new DynamicStructuredTool({
    name: "findNearbyAdministrativeAreas",
    description: "Tìm kiếm và liệt kê các tỉnh hoặc thành phố gần nhất với một địa điểm cụ thể. Công cụ này hữu ích khi người dùng muốn biết các khu vực hành chính lân cận. Trả về danh sách các tỉnh/thành phố gần nhất.",
    schema: {
        type: "object",
        properties: {
            centerLocationName: {
                type: "string",
                description: "Tên của địa điểm trung tâm để tìm các tỉnh/thành phố lân cận (ví dụ: 'Hà Nội', 'Đà Nẵng')."
            },
            maxResults: {
                type: "number",
                description: "Số lượng tỉnh/thành phố tối đa cần trả về (mặc định là 5).",
                minimum: 1,
                maximum: 10
            }
        },
        required: ["centerLocationName"],
    } as const,
    func: async (input: { centerLocationName: string; maxResults?: number }) => {
        return _findNearbyAdministrativeAreas(input.centerLocationName, input.maxResults);
    },
});

// Định nghĩa công cụ cho LangChain với schema dạng object literal
export const getDetailedAddressTool = new DynamicStructuredTool({
    name: "getDetailedAddress",
    description: "Chuyển đổi tọa độ địa lý (vĩ độ, kinh độ) thành địa chỉ chi tiết (số nhà, tên đường, phường/xã, quận/huyện, tỉnh/thành phố). Hữu ích khi người dùng hỏi 'địa chỉ của tọa độ này là gì' hoặc 'tọa độ này ở đâu'.",
    schema: {
        type: "object",
        properties: {
            latitude: {
                type: "number",
                description: "Vĩ độ của địa điểm cần tìm địa chỉ chi tiết."
            },
            longitude: {
                type: "number",
                description: "Kinh độ của địa điểm cần tìm địa chỉ chi tiết."
            },
        },
        required: ["latitude", "longitude"] // Cần đảm bảo cả vĩ độ và kinh độ đều được cung cấp
    } as const, // Sử dụng 'as const' để đảm bảo type inference chính xác
    func: async (input: { latitude: number; longitude: number }) => {
        return _getDetailedAddress(input.latitude, input.longitude);
    },
});

export const getDetailRouteDirectionsTool = new DynamicStructuredTool({
    name: "get_route_directions_with_waypoints",
    description: `Tính toán chi tiết tuyến đường giữa hai hoặc nhiều điểm, bao gồm thời gian, khoảng cách, URL bản đồ, và các điểm tọa độ của tuyến đường. Có thể cung cấp tên địa điểm hoặc vĩ độ/kinh độ cho điểm bắt đầu, điểm kết thúc và các điểm trung gian. Ưu tiên sử dụng tên địa điểm nếu có để tìm kiếm chính xác hơn. `,
    schema: {
        type: "object",
        properties: {
            startLocationName: {
                type: "string",
                description: 'Tên địa điểm bắt đầu của tuyến đường (ví dụ: "Tháp Eiffel", "Sân bay Quốc tế Nội Bài"). Sử dụng cái này HOẶC startLatitude/startLongitude',
                nullable: true,
            },
            startLatitude: {
                type: "number",
                description: 'Vĩ độ của điểm bắt đầu. Chỉ sử dụng khi không có startLocationName và bạn có tọa độ chính xác. Phải được cung cấp cùng với startLongitude.',
                nullable: true,
            },
            startLongitude: {
                type: "number",
                description: 'Kinh độ của điểm bắt đầu. Chỉ sử dụng khi không có startLocationName và bạn có tọa độ chính xác. Phải được cung cấp cùng với startLatitude.',
                nullable: true,
            },
            endLocationName: {
                type: "string",
                description: 'Tên địa điểm kết thúc của tuyến đường (ví dụ: "Nhà hát Lớn Hà Nội", "Cầu Long Biên"). Sử dụng cái này HOẶC endLatitude/endLongitude.',
                nullable: true,
            },
            endLatitude: {
                type: "number",
                description:'Vĩ độ của điểm kết thúc. Chỉ sử dụng khi không có endLocationName và bạn có tọa độ chính xác. Phải được cung cấp cùng với endLongitude.',
                nullable: true,
            },
            endLongitude: {
                type: "number",
                description: 'Kinh độ của điểm kết thúc. Chỉ sử dụng khi không có endLocationName và bạn có tọa độ chính xác. Phải được cung cấp cùng với endLatitude.',
                nullable: true,
            },
            waypoints: {
                type: "array",
                description: 'Một mảng các điểm trung gian trên tuyến đường. Mỗi điểm có thể là một chuỗi tên địa điểm hoặc một đối tượng { latitude: number; longitude: number; }.',
                items: {
                    oneOf: [
                        {
                            type: "string",
                             description: 'Tên địa điểm của một điểm trung gian (ví dụ: "Bệnh viện Bạch Mai").',
                        },
                        {
                            type: 'object',
                            properties: {
                                latitude: {
                                type: 'number',
                                description: 'Vĩ độ của điểm trung gian.',
                                },
                                longitude: {
                                type: 'number',
                                description: 'Kinh độ của điểm trung gian.',
                                },
                            },
                            required: ['latitude', 'longitude'],
                            description: 'Tọa độ (vĩ độ, kinh độ) của một điểm trung gian.',
            },
                    ]
                },
                nullable: true,
            },
        },
        required: [], 
    } as const,

  func: async (input) => {
    // THÊM LOGIC XÁC THỰC THỦ CÔNG TẠI ĐÂY (NẾU CẦN)
    // Vì JSON Schema không mạnh bằng Zod trong việc xử lý các ràng buộc phức tạp (như "HOẶC"),
    // bạn nên thêm các kiểm tra để đảm bảo đầu vào hợp lệ trước khi gọi hàm gốc.
    const {
      startLocationName,
      startLatitude,
      startLongitude,
      endLocationName,
      endLatitude,
      endLongitude,
      waypoints
    } = input as { // Ép kiểu input để Typescript hiểu cấu trúc
      startLocationName?: string,
      startLatitude?: number,
      startLongitude?: number,
      endLocationName?: string,
      endLatitude?: number,
      endLongitude?: number,
      waypoints?: Array<string | { latitude: number; longitude: number }>
    };

    const hasStartName = startLocationName !== undefined;
    const hasStartCoords = startLatitude !== undefined && startLongitude !== undefined;
    if (!hasStartName && !hasStartCoords) {
      console.error('Lỗi: Phải cung cấp đủ thông tin cho điểm bắt đầu (tên địa điểm HOẶC cả vĩ độ và kinh độ).');
      return null;
    }
    if ((startLatitude !== undefined && startLongitude === undefined) ||
        (startLatitude === undefined && startLongitude !== undefined)) {
      console.error('Lỗi: Nếu cung cấp vĩ độ cho điểm bắt đầu, phải cung cấp cả kinh độ.');
      return null;
    }

    const hasEndName = endLocationName !== undefined;
    const hasEndCoords = endLatitude !== undefined && endLongitude !== undefined;
    if (!hasEndName && !hasEndCoords) {
      console.error('Lỗi: Phải cung cấp đủ thông tin cho điểm kết thúc (tên địa điểm HOẶC cả vĩ độ và kinh độ).');
      return null;
    }
    if ((endLatitude !== undefined && endLongitude === undefined) ||
        (endLatitude === undefined && endLongitude !== undefined)) {
      console.error('Lỗi: Nếu cung cấp vĩ độ cho điểm kết thúc, phải cung cấp cả kinh độ.');
      return null;
    }

    // Sau khi xác thực, gọi hàm gốc của bạn
    return getDetailsRouteDirections(
      startLocationName,
      startLatitude,
      startLongitude,
      endLocationName,
      endLatitude,
      endLongitude,
      waypoints
    );
  },
});

export const geographyTool = new DynamicStructuredTool({
    name: "get_geographical_information",
    description: "Trả lời các câu hỏi về vị trí của các quốc gia, thành phố, và địa danh nổi tiếng trên thế giới. Cung cấp tọa độ, loại địa điểm và các thông tin địa chỉ liên quan.",
    schema:{
        type: "object",
        properties: {
        locationName:{
            type: "string",
            description: "Tên của quốc gia, thành phố, hoặc địa danh nổi tiếng cần tìm thông tin địa lý."},
        },
        required: ["locationName"], 
    } as const,
    func: async (input:{ locationName :string }) => {
        return getGeographyInfoWithNominatim(input.locationName);
    },
});

export const placesTool = new DynamicStructuredTool({
  name: "search_nearby_places",
  description: "Tìm kiếm các địa điểm cụ thể (nhà hàng, quán cà phê, bệnh viện, trường học, trạm xăng, v.v.) gần một vị trí hoặc trong một khu vực nhất định. Cần 'query' để biết loại địa điểm cần tìm và có thể cần 'latitude', 'longitude', 'radius' để xác định khu vực.",
  schema:{
    type: "object",
    properties: {
        query: {
            type: "string",
            description: "Loại địa điểm cần tìm kiếm, ví dụ: 'nhà hàng', 'quán cà phê', 'bệnh viện', 'trạm xăng'.",
        },
        latitude : {
            type: "number",
            description: "Vĩ độ của vị trí trung tâm để tìm kiếm. Cung cấp nếu người dùng hỏi gần vị trí của họ hoặc một tọa độ cụ thể."
        },
        longitude : {
            type: "number",
            description: "Kinh độ của vị trí trung tâm để tìm kiếm. Cung cấp nếu người dùng hỏi gần vị trí của họ hoặc một tọa độ cụ thể."
        },
        radius : {
            type: "number",
            description: "Bán kính tìm kiếm tính bằng mét (m). Nominatim không hỗ trợ tham số này trực tiếp, nhưng việc cung cấp tọa độ sẽ ưu tiên các kết quả gần đó."
        }

    }
  } as const,
  func: async (input:{ query: string, latitude : number, longitude : number, radius: number }) => {
    return searchPlacesWithNominatim(input.query, input.latitude, input.longitude, input.radius);
  },
});

export const openrouteserviceTool = new DynamicStructuredTool({
    name: "get_detailed_route_directions",
    description: "Cung cấp thông tin lộ trình chi tiết bao gồm tổng khoảng cách, thời gian di chuyển ước tính, và danh sách các bước đi cụ thể (ví dụ: 'rẽ trái', 'đi thẳng') giữa hai địa điểm. Công cụ này yêu cầu tên của địa điểm xuất phát và địa điểm đích.",
    schema: {
        type: "object",
        properties: {
            startLocationName : {
                type: "string",
                description : "Tên của địa điểm xuất phát (ví dụ: 'Nhà tôi', 'Trường Đại học Bách Khoa Hà Nội').",
            },
            endLocationName : {
                type: "string",
                description : "Tên của địa điểm đích (ví dụ: 'Hồ Gươm', 'Sân bay Nội Bài').",
            }
        }
    } as const,
    func: async (input :{ startLocationName : string, endLocationName : string }) => {
        return getOpenrouteserviceDirections(input.startLocationName,input.endLocationName);
    },
});

