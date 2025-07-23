// src/tools/weatherTool.ts
import axios from 'axios';
import prisma from '../libs/prisma';
import { DynamicStructuredTool,DynamicStructuredToolInput } from "@langchain/core/tools";
import {WeatherData} from '../generated/prisma';

import {getCoordinatesForLocation ,_getDetailedAddress } from "./locationTool";

const OPENWEATHER_API_KEY = process.env.OPENWEATHER_API_KEY;
const OPENWEATHER_BASE_URL = 'https://api.openweathermap.org/data/2.5/weather';
const OPENWEATHER_FORECAST_URL = 'https://api.openweathermap.org/data/2.5/forecast';


/**
 * Lấy dữ liệu thời tiết hiện tại cho một địa điểm.
 * Ưu tiên lấy từ DB nếu dữ liệu còn mới (ví dụ: trong 30 phút).
 * Sau đó gọi OpenWeatherMap API và lưu vào DB.
 * @param locationName Tên địa điểm (ví dụ: "Hà Nội").
 * @param latitude Vĩ độ của địa điểm.
 * @param longitude Kinh độ của địa điểm.
 * @returns Thông tin thời tiết đã lưu hoặc null.
 */
export async function getAndStoreWeatherData(locationName: string): Promise<any | null> {
    if (!OPENWEATHER_API_KEY) {
        console.error("[WeatherTool] OPENWEATHER_API_KEY is not set in .env");
        return null;
    }

    try {
        // Bước 1: Kiểm tra dữ liệu trong DB
        // Tìm locationId từ locationName hoặc tạo mới nếu chưa có
        let locationData = await prisma.locationData.findUnique({
            where: { name: locationName },
            select: { id: true, weather: { orderBy: { timestamp: 'desc' }, take: 1 } }
        });

        if (locationData && locationData.weather.length > 0) {
            const latestWeather = locationData.weather[0];
            const now = new Date();
            // Cache timeout: 30 phút. Có thể điều chỉnh.
            const cacheTimeoutMinutes = 30;
            const cacheValidUntil = new Date(latestWeather.timestamp.getTime() + cacheTimeoutMinutes * 60 * 1000);

            if (now.getTime() < cacheValidUntil.getTime()) {
                console.log(`[WeatherTool] Found recent weather data for "${locationName}" in DB (valid for ${cacheTimeoutMinutes} mins).`);
                return latestWeather;
            }
        }

        const location = await getCoordinatesForLocation(locationName);

        console.log(`[WeatherTool] Fetching new weather data for "${locationName}" from OpenWeatherMap API...`);

        // Bước 2: Gọi OpenWeatherMap API
        const response = await axios.get(OPENWEATHER_BASE_URL, {
            params: {
                lat: location?.latitude,
                lon: location?.longitude,
                appid: OPENWEATHER_API_KEY,
            }
        });

        if (response.data) {
            const data = response.data;
            const weatherMain = data.weather[0] ? data.weather[0].main : 'N/A';
            const weatherDescription = data.weather[0] ? data.weather[0].description : 'Không xác định';
            const weatherIcon = data.weather[0] ? data.weather[0].icon : 'N/A';

            // Đảm bảo location tồn tại hoặc tạo mới và lấy ID
            // Sử dụng một transaction để đảm bảo tính nhất quán nếu bạn muốn tạo LocationData
            // và WeatherData cùng một lúc, hoặc chỉ đơn giản là tìm/tạo LocationData trước
            let existingLocation = await prisma.locationData.findUnique({
                where: { name: locationName }
            });

            if (!existingLocation || !existingLocation.id) {
                throw new Error("Could not find or create location record for weather data.");
            }

            // Bước 3: Lưu dữ liệu thời tiết mới vào DB
            const newWeatherEntry = await prisma.weatherData.create({
                data: {
                    locationId: existingLocation.id,
                    temperature: data.main.temp,
                    feels_like: data.main.feels_like,
                    temp_min: data.main.temp_min,
                    temp_max: data.main.temp_max,
                    pressure: data.main.pressure,
                    humidity: data.main.humidity,
                    visibility: data.visibility,
                    windSpeed: data.wind.speed,
                    windDeg: data.wind.deg,
                    cloudsAll: data.clouds.all,
                    description: weatherDescription,
                    icon: weatherIcon,
                    main: weatherMain,
                    sunrise: data.sys.sunrise ? new Date(data.sys.sunrise * 1000) : null, // UNIX timestamp to Date
                    sunset: data.sys.sunset ? new Date(data.sys.sunset * 1000) : null,   // UNIX timestamp to Date
                    timezoneOffset: data.timezone, // Độ lệch múi giờ (giây)
                    timestamp: new Date(data.dt * 1000), // Thời điểm dữ liệu được lấy (UNIX timestamp to Date)
                }
            });
            console.log(data.main);
            console.log(`[WeatherTool] Saved new weather data for "${locationName}" to DB.`);
            return newWeatherEntry;
        }
        return null;
    } catch (error) {
        console.error(`[WeatherTool] Error fetching or storing weather data for "${locationName}":`, error);
        // Có thể log thêm chi tiết lỗi từ Axios response nếu có
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[WeatherTool] OpenWeatherMap API Error Response:`, error.response.data);
        }
        return null;
    }
}

export async function getAndStorePointWeatherData(latitude: number, longitude: number): Promise<any | null> {
    if (!OPENWEATHER_API_KEY) {
        console.error("[WeatherTool] OPENWEATHER_API_KEY is not set in .env");
        return null;
    }

    try {
        const locationName = await _getDetailedAddress(latitude, longitude)  ;


        // Bước 1: Kiểm tra dữ liệu trong DB
        // Tìm locationId từ locationName hoặc tạo mới nếu chưa có
        let locationData = await prisma.locationData.findUnique({
            where: { name: locationName },
            select: { id: true, weather: { orderBy: { timestamp: 'desc' }, take: 1 } }
        });

        if (locationData && locationData.weather.length > 0) {
            const latestWeather = locationData.weather[0];
            const now = new Date();
            // Cache timeout: 30 phút. Có thể điều chỉnh.
            const cacheTimeoutMinutes = 30;
            const cacheValidUntil = new Date(latestWeather.timestamp.getTime() + cacheTimeoutMinutes * 60 * 1000);

            if (now.getTime() < cacheValidUntil.getTime()) {
                console.log(`[WeatherTool] Found recent weather data for "${locationName}" in DB (valid for ${cacheTimeoutMinutes} mins).`);
                return latestWeather;
            }
        }

        const location = await getCoordinatesForLocation(locationName);

        console.log(`[WeatherTool] Fetching new weather data for "${locationName}" from OpenWeatherMap API...`);

        // Bước 2: Gọi OpenWeatherMap API
        const response = await axios.get(OPENWEATHER_BASE_URL, {
            params: {
                lat: location?.latitude,
                lon: location?.longitude,
                appid: OPENWEATHER_API_KEY,
            }
        });

        if (response.data) {
            const data = response.data;
            const weatherMain = data.weather[0] ? data.weather[0].main : 'N/A';
            const weatherDescription = data.weather[0] ? data.weather[0].description : 'Không xác định';
            const weatherIcon = data.weather[0] ? data.weather[0].icon : 'N/A';

            // Đảm bảo location tồn tại hoặc tạo mới và lấy ID
            // Sử dụng một transaction để đảm bảo tính nhất quán nếu bạn muốn tạo LocationData
            // và WeatherData cùng một lúc, hoặc chỉ đơn giản là tìm/tạo LocationData trước
            let existingLocation = await prisma.locationData.findUnique({
                where: { name: locationName }
            });

            if (!existingLocation || !existingLocation.id) {
                throw new Error("Could not find or create location record for weather data.");
            }

            // Bước 3: Lưu dữ liệu thời tiết mới vào DB
            const newWeatherEntry = await prisma.weatherData.create({
                data: {
                    locationId: existingLocation.id,
                    temperature: data.main.temp,
                    feels_like: data.main.feels_like,
                    temp_min: data.main.temp_min,
                    temp_max: data.main.temp_max,
                    pressure: data.main.pressure,
                    humidity: data.main.humidity,
                    visibility: data.visibility,
                    windSpeed: data.wind.speed,
                    windDeg: data.wind.deg,
                    cloudsAll: data.clouds.all,
                    description: weatherDescription,
                    icon: weatherIcon,
                    main: weatherMain,
                    sunrise: data.sys.sunrise ? new Date(data.sys.sunrise * 1000) : null, // UNIX timestamp to Date
                    sunset: data.sys.sunset ? new Date(data.sys.sunset * 1000) : null,   // UNIX timestamp to Date
                    timezoneOffset: data.timezone, // Độ lệch múi giờ (giây)
                    timestamp: new Date(data.dt * 1000), // Thời điểm dữ liệu được lấy (UNIX timestamp to Date)
                }
            });
            console.log(data.main);
            console.log(`[WeatherTool] Saved new weather data for "${locationName}" to DB.`);
            return newWeatherEntry;
        }
        return null;
    } catch (error) {
        console.error(`[WeatherTool] Error fetching or storing weather data :`, error);
        // Có thể log thêm chi tiết lỗi từ Axios response nếu có
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[WeatherTool] OpenWeatherMap API Error Response:`, error.response.data);
        }
        return null;
    }
}


interface DailyForecast {
    date: string;
    temp_min: number;
    temp_max: number;
    description: string;
}

interface DailyWeatherSummary {
    date: string; // YYYY-MM-DD
    description: string;
    temperature: {
        min: number;
        max: number;
        avg: number;
    };
    feels_like: {
        min: number;
        max: number;
        avg: number;
    };
    humidity: {
        min: number;
        max: number;
        avg: number;
    };
    pressure: {
        min: number;
        max: number;
        avg: number;
    };
    windSpeed: {
        min: number;
        max: number;
        avg: number;
    };
    cloudsAll: {
        min: number;
        max: number;
        avg: number;
    } | null; // Có thể null nếu dữ liệu không có
    visibility: {
        min: number;
        max: number;
        avg: number;
    } | null; // Có thể null nếu dữ liệu không có
    // Bạn có thể thêm các trường khác nếu muốn tổng hợp min/max/avg
}

export function summarizeDailyWeatherData(weatherDataArray: WeatherData[]): DailyWeatherSummary[] {
    const dailySummaries: { [date: string]: { data: WeatherData[]; descriptions: string[] } } = {};
    // 1. Nhóm dữ liệu theo ngày
    weatherDataArray.forEach(data => {
        if (!data.timestamp) {
            console.warn(`[summarizeDailyWeatherData] Dữ liệu thời tiết thiếu timestamp, bỏ qua:`, data);
            return; // Bỏ qua bản ghi này nếu timestamp không hợp lệ
        }

        const dateKey = data.timestamp.toISOString().split('T')[0]; // Lấy YYYY-MM-DD
        if (!dailySummaries[dateKey]) {
            dailySummaries[dateKey] = { data: [], descriptions: [] };
        }
        dailySummaries[dateKey].data.push(data);
        dailySummaries[dateKey].descriptions.push(data.description);
    });

    const result: DailyWeatherSummary[] = [];

    // 2. Xử lý từng ngày
    for (const dateKey in dailySummaries) {
        const { data, descriptions } = dailySummaries[dateKey];

        if (data.length === 0) continue; // Bỏ qua nếu không có dữ liệu

        // Tìm mô tả xuất hiện nhiều nhất
        const descriptionCounts: { [desc: string]: number } = {};
        let mostFrequentDescription = '';
        let maxCount = 0;
        descriptions.forEach(desc => {
            descriptionCounts[desc] = (descriptionCounts[desc] || 0) + 1;
            if (descriptionCounts[desc] > maxCount) {
                maxCount = descriptionCounts[desc];
                mostFrequentDescription = desc;
            }
        });

        // Thu thập các giá trị để tính min/max/avg
        const temperatures = data.map(d => d.temperature);
        const feelsLikes = data.map(d => d.feels_like);
        const humidities = data.map(d => d.humidity);
        const pressures = data.map(d => d.pressure);
        const windSpeeds = data.map(d => d.windSpeed);

        // Xử lý các trường có thể null/undefined
        const cloudsAlls = data.map(d => d.cloudsAll).filter(v => v !== null && v !== undefined) as number[];
        const visibilities = data.map(d => d.visibility).filter(v => v !== null && v !== undefined) as number[];

        // Hàm tiện ích để tính min/max/avg
        const calculateStats = (arr: number[]) => {
            if (arr.length === 0) return { min: 0, max: 0, avg: 0 }; // Hoặc giá trị mặc định khác
            const sum = arr.reduce((a, b) => a + b, 0);
            return {
                min: Math.min(...arr),
                max: Math.max(...arr),
                avg: parseFloat((sum / arr.length).toFixed(2)) // Làm tròn 2 chữ số thập phân
            };
        };

        result.push({
            date: dateKey,
            description: mostFrequentDescription,
            temperature: calculateStats(temperatures),
            feels_like: calculateStats(feelsLikes),
            humidity: calculateStats(humidities),
            pressure: calculateStats(pressures),
            windSpeed: calculateStats(windSpeeds),
            cloudsAll: cloudsAlls.length > 0 ? calculateStats(cloudsAlls) : null,
            visibility: visibilities.length > 0 ? calculateStats(visibilities) : null,
        });
    }

    // Sắp xếp kết quả theo ngày tăng dần
    result.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    return result;
}


async function formatWeatherForecastData(forecastData: any, days: number): Promise<any | null> {
    const dailyForecasts: DailyForecast[] = [];
    const forecastsByDay: { [key: string]: any[] } = {};
    forecastData.

    forecastData.list.forEach((item: any) => {
        const date = new Date(item.dt * 1000);
        const dateKey = date.toISOString().split('T')[0];
        if (!forecastsByDay[dateKey]) {
            forecastsByDay[dateKey] = [];
        }
        forecastsByDay[dateKey].push(item);
    });

    let count = 0;
    for (const dateKey in forecastsByDay) {
        if (count >= days) break;

        const dayData = forecastsByDay[dateKey];
        const temps = dayData.map((item: any) => item.main.temp);
        const descriptions = dayData.map((item: any) => item.weather[0].description);
        console.log(forecastsByDay[dateKey]);

        dailyForecasts.push({
            date: dateKey,
            temp_min: Math.min(...temps),
            temp_max: Math.max(...temps),
            description: descriptions[Math.floor(descriptions.length / 2)] || descriptions[0],
        });
        count++;
    }
    return dailyForecasts;
}


/**
 * Lấy dự báo thời tiết cho một địa điểm và số ngày.
 * @param location Tên địa điểm.
 * @param days Số ngày dự báo (tối đa 5 ngày với API miễn phí của OpenWeatherMap).
 * @returns Thông tin dự báo thời tiết.
 */
export async function getWeatherForecast(locationName: string, days: number): Promise<WeatherData[] | string> {

    try {
        if (days > 5) {
            return "Hiện tại chỉ có thể dự báo tối đa 5 ngày.";
        }
        const location = await getCoordinatesForLocation(locationName);

        if (!location) {
            return `Không thể lấy tọa độ cho địa điểm: ${location}.`;
        }
        const now = new Date();
        const forecastEndDate = new Date();
        // Thêm số ngày yêu cầu, cộng thêm một chút để đảm bảo bao phủ đủ (ví dụ: thêm 24h để lấy đủ dữ liệu cuối ngày cuối cùng)
        forecastEndDate.setDate(now.getDate() + days);
        // Đặt giờ/phút/giây về 00:00:00 của ngày hiện tại để chuẩn hóa so sánh
        now.setHours(0, 0, 0, 0);


        // --- Bước 1: Kiểm tra dữ liệu trong Cache (Database) ---
        // Giới hạn thời gian hiệu lực của cache (ví dụ: 1 giờ)
        const CACHE_VALIDITY_MINUTES = 60; // Dữ liệu chi tiết 3h/lần nên cache trong 1-2h là hợp lý
        const cacheValidThreshold = new Date(Date.now() - CACHE_VALIDITY_MINUTES * 60 * 1000);

        const cachedDetailedWeatherData = await prisma.weatherData.findMany({
            where: {
                locationId: location.id,
                createdAt: {
                    gte: cacheValidThreshold, // Bản ghi được tạo trong khoảng thời gian cache còn hiệu lực
                },
                timestamp: { // Timestamp của bản ghi phải nằm trong khoảng dự báo
                    gte: now,
                    lte: forecastEndDate,
                }
            },
            orderBy: {
                timestamp: 'asc' // Sắp xếp theo thời gian để dễ dàng xử lý sau này
            }
        });

        const expectedDataPoints = days * 8; // 8 điểm * số ngày
        const minPointsToConsiderCache = Math.max(days * 4, 10); // Ít nhất 4 điểm/ngày hoặc 10 điểm tổng cộng

        if (cachedDetailedWeatherData.length >= minPointsToConsiderCache &&
            cachedDetailedWeatherData.length >= (expectedDataPoints * 0.8)) {
            console.log(`[WeatherTool] Tìm thấy ${cachedDetailedWeatherData.length} bản ghi thời tiết chi tiết gần đây cho "${locationName}" trong DB. Đang sử dụng dữ liệu từ cache.`);
            return cachedDetailedWeatherData;
        }else {
            console.log(`[get_weather_forecast] Cache không đủ hoặc hết hạn. Gọi API OpenWeatherMap.`);
        }


        // const forecastResponse = await axios.get(
        //     `https://api.openweathermap.org/data/2.5/forecast?lat=${location.latitude}&lon=${location.longitude}&appid=${OPENWEATHER_API_KEY}&units=metric&lang=vi`
        // );
          const response = await axios.get(OPENWEATHER_FORECAST_URL, {
            params: {
                lat: location?.latitude,
                lon: location?.longitude,
                appid: OPENWEATHER_API_KEY,
                units: "metric",
                lang : "vi"
            }
        });

        // return formatWeatherForecastData(response.data,days);

        const apiForecastData = response.data;

        // Lấy thông tin mặt trời mọc/lặn và múi giờ từ thông tin thành phố (thường chỉ có 1 lần cho cả dự báo)
        const citySunrise = apiForecastData.city?.sunrise ? new Date(apiForecastData.city.sunrise * 1000) : null;
        const citySunset = apiForecastData.city?.sunset ? new Date(apiForecastData.city.sunset * 1000) : null;
        const cityTimezoneOffset = apiForecastData.city?.timezone;
        // --- Bước 3: Lưu trữ từng điểm dữ liệu 3 giờ vào Database (WeatherData) ---
        // Sử dụng Promise.allSettled để thực hiện song song và xử lý lỗi cho từng bản ghi
        const upsertPromises = apiForecastData.list.map(async (dataPoint: any) => {
            try {
                // Trích xuất thông tin thời tiết chính
                const weatherMain = dataPoint.weather[0]?.main || 'N/A';
                const weatherDescription = dataPoint.weather[0]?.description || 'Không xác định';
                const weatherIcon = dataPoint.weather[0]?.icon || 'N/A';
                const timestampDate = new Date(dataPoint.dt * 1000); // Chuyển đổi UNIX timestamp sang Date

                // Lưu hoặc cập nhật bản ghi WeatherData
                const newWeatherEntry = await prisma.weatherData.upsert({
                    where: {
                        // Sử dụng composite unique key [locationId, timestamp]
                        locationId_timestamp: {
                            locationId: location.id,
                            timestamp: timestampDate,
                        },
                    },
                    update: { // Cập nhật các trường nếu bản ghi đã tồn tại
                        temperature: dataPoint.main.temp,
                        feels_like: dataPoint.main.feels_like,
                        temp_min: dataPoint.main.temp_min,
                        temp_max: dataPoint.main.temp_max,
                        pressure: dataPoint.main.pressure,
                        humidity: dataPoint.main.humidity,
                        visibility: dataPoint.visibility,
                        windSpeed: dataPoint.wind.speed,
                        windDeg: dataPoint.wind.deg,
                        cloudsAll: dataPoint.clouds.all,
                        description: weatherDescription,
                        icon: weatherIcon,
                        main: weatherMain,
                        sunrise: citySunrise,
                        sunset: citySunset,
                        timezoneOffset: cityTimezoneOffset,
                    },
                    create: { // Tạo bản ghi mới nếu chưa tồn tại
                        locationId: location.id,
                        temperature: dataPoint.main.temp,
                        feels_like: dataPoint.main.feels_like,
                        temp_min: dataPoint.main.temp_min,
                        temp_max: dataPoint.main.temp_max,
                        pressure: dataPoint.main.pressure,
                        humidity: dataPoint.main.humidity,
                        visibility: dataPoint.visibility,
                        windSpeed: dataPoint.wind.speed,
                        windDeg: dataPoint.wind.deg,
                        cloudsAll: dataPoint.clouds.all,
                        description: weatherDescription,
                        icon: weatherIcon,
                        main: weatherMain,
                        sunrise: citySunrise,
                        sunset: citySunset,
                        timezoneOffset: cityTimezoneOffset,
                        timestamp: timestampDate,
                    }
                });
                return { status: 'fulfilled', value: newWeatherEntry as WeatherData }; // Ép kiểu về WeatherData
            } catch (dbError: any) {
                console.error(`[WeatherTool] Lỗi khi lưu dữ liệu thời tiết chi tiết tại ${new Date(dataPoint.dt * 1000).toISOString()}:`, dbError.message);
                return { status: 'rejected', reason: dbError };
            }
        });

        // Chờ tất cả các thao tác lưu/cập nhật hoàn thành
        const results = await Promise.allSettled(upsertPromises);
        const savedWeatherEntries: WeatherData[] = [];

        // Thu thập các bản ghi đã được lưu thành công
        results.forEach(result => {
            if (result.status === 'fulfilled' && result.value) {
                savedWeatherEntries.push(result.value);
            }
        });
        if (savedWeatherEntries.length > 0) {
            console.log(`[WeatherTool] Đã lưu ${savedWeatherEntries.length} bản ghi thời tiết chi tiết cho "${locationName}" vào DB.`);
            // Trả về các bản ghi chi tiết đã lưu
            return savedWeatherEntries;
        } else {
            return `Không có dữ liệu thời tiết chi tiết nào được tìm thấy hoặc lưu trữ cho **${locationName}**. Vui lòng thử lại sau.`;
        }

    } catch (error) {
        console.error("Lỗi khi lấy dự báo thời tiết:", error);
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[DEBUG] OpenWeatherMap API Error Response (in catch):`, error.response.data);
        }

        return "Không thể lấy thông tin dự báo thời tiết. Vui lòng thử lại sau.";
    }
}

export async function get_weather_forecast(locationName: string, days: number) {
    console.log(`Đang lấy dự báo thời tiết chi tiết cho ${locationName} trong ${days} ngày tới...`);
    const detailedWeatherDataRaw = await getWeatherForecast(locationName, days);
        // console.log(detailedWeatherData);

    if (typeof detailedWeatherDataRaw === 'string') {
        console.error(`Lỗi: ${detailedWeatherDataRaw}`);
        return detailedWeatherDataRaw;
    }

    if (detailedWeatherDataRaw.length === 0) {
        return `Không tìm thấy dữ liệu thời tiết chi tiết nào cho ${locationName}.`;
    }
    const detailedWeatherData: WeatherData[] = detailedWeatherDataRaw.map(item => {
        // Giả sử item có thể là { status: 'fulfilled', value: WeatherData }
        // Hoặc nó có thể đã là WeatherData trực tiếp nếu đến từ cache Prisma
        return (item as any).value || item; // Lấy .value nếu tồn tại, ngược lại lấy chính item
    }).filter(Boolean) as WeatherData[]; // Lọc bỏ các giá trị null/undefined nếu có và ép kiểu

    console.log(`Đã nhận được ${detailedWeatherData.length} bản ghi thời tiết chi tiết. Đang tổng hợp...`);
    const dailySummaries = summarizeDailyWeatherData(detailedWeatherData);
    console.log(`Dự báo thời tiết hàng ngày cho ${locationName}:`);
    let output = `Dự báo thời tiết cho **${locationName}** trong ${days} ngày tới:\n\n`;

    dailySummaries.forEach(daySummary => {
        output += `---
        **Ngày ${daySummary.date}:**
        - **Mô tả:** ${daySummary.description}
        - **Nhiệt độ:** ${daySummary.temperature.min}°C (thấp nhất) - ${daySummary.temperature.max}°C (cao nhất), trung bình ${daySummary.temperature.avg}°C
        - **Cảm giác như:** ${daySummary.feels_like.min}°C (thấp nhất) - ${daySummary.feels_like.max}°C (cao nhất), trung bình ${daySummary.feels_like.avg}°C
        - **Độ ẩm:** ${daySummary.humidity.min}% (thấp nhất) - ${daySummary.humidity.max}% (cao nhất), trung bình ${daySummary.humidity.avg}%
        - **Áp suất:** ${daySummary.pressure.min} hPa (thấp nhất) - ${daySummary.pressure.max} hPa (cao nhất), trung bình ${daySummary.pressure.avg} hPa
        - **Tốc độ gió:** ${daySummary.windSpeed.min} m/s (thấp nhất) - ${daySummary.windSpeed.max} m/s (cao nhất), trung bình ${daySummary.windSpeed.avg} m/s
        `;
        if (daySummary.cloudsAll) {
            output += `- **Mây:** ${daySummary.cloudsAll.min}% (thấp nhất) - ${daySummary.cloudsAll.max}% (cao nhất), trung bình ${daySummary.cloudsAll.avg}%\n`;
        }
        if (daySummary.visibility) {
            output += `- **Tầm nhìn:** ${daySummary.visibility.min}m (thấp nhất) - ${daySummary.visibility.max}m (cao nhất), trung bình ${daySummary.visibility.avg}m\n`;
        }
    });

    console.log(output);
    return output;
}

export async function get_all_weather_forecast(locationName: string) {
    const detailedWeatherDataRaw = await getWeatherForecast(locationName, 5);
    if (typeof detailedWeatherDataRaw === 'string') {
        console.error(`Lỗi: ${detailedWeatherDataRaw}`);
        return detailedWeatherDataRaw;
    }

    if (detailedWeatherDataRaw.length === 0) {
        return `Không tìm thấy dữ liệu thời tiết chi tiết nào cho ${locationName}.`;
    }

        const detailedWeatherData: WeatherData[] = detailedWeatherDataRaw.map(item => {
        // Giả sử item có thể là { status: 'fulfilled', value: WeatherData }
        // Hoặc nó có thể đã là WeatherData trực tiếp nếu đến từ cache Prisma
        return (item as any).value || item; // Lấy .value nếu tồn tại, ngược lại lấy chính item
    }).filter(Boolean) as WeatherData[]; // Lọc bỏ các giá trị null/undefined nếu có và ép kiểu

    let output = `Dự báo thời tiết cho **${locationName}** trong 5 ngày tới:\n\n`;

    detailedWeatherData.forEach(daySummary => {
        output += `---
        **Ngày ${daySummary.timestamp}:**
        - **Mô tả:** ${daySummary.description}
        - **Nhiệt độ:** ${daySummary.temp_min}°C (thấp nhất) - ${daySummary.temp_max}°C (cao nhất)
        - **Cảm giác như:** ${daySummary.feels_like}°C 
        - **Độ ẩm:** ${daySummary.humidity}% 
        - **Áp suất:** ${daySummary.pressure} hPa
        - **Tốc độ gió:** ${daySummary.windSpeed} m/s
        - **Mây:** ${daySummary.cloudsAll}% 
        - **Tầm nhìn:** ${daySummary.visibility}m
        `;
    });
    return output;


}

export async function getWeatherAlerts(locationName: string): Promise<string> {
    if (!OPENWEATHER_API_KEY || OPENWEATHER_API_KEY === "YOUR_OPENWEATHER_API_KEY") {
        return "Lỗi: Không tìm thấy OpenWeatherMap API Key. Vui lòng cung cấp khóa API hợp lệ.";
    }

    // Bước 1: Lấy tọa độ từ tên địa điểm sử dụng công cụ getCoordinatesForLocation
    const coordsResult = await getCoordinatesForLocation(locationName);
    let latitude: number | undefined;
    let longitude: number | undefined;

    try {
        const parsedCoords = coordsResult;

        if(parsedCoords === null){
            return "Cần địa điểm để tìm";
        }

        if (parsedCoords.latitude && parsedCoords.longitude) {
            latitude = parsedCoords.latitude;
            longitude = parsedCoords.longitude;
        } else {
            return `Không tìm thấy tọa độ cho địa điểm "${locationName}". Vui lòng thử lại với tên địa điểm chính xác hơn.`;
        }
    } catch (e) {
        return `Không tìm thấy tọa độ cho địa điểm "${locationName}". Vui lòng thử lại với tên địa điểm chính xác hơn.`;
    }

    const OWM_ONE_CALL_URL = `https://api.openweathermap.org/data/3.0/onecall`;

    try {
        console.log(`Đang lấy cảnh báo thời tiết cho ${locationName} (${latitude}, ${longitude})...`);
        const response = await axios.get(OWM_ONE_CALL_URL, {
            params: {
                lat: latitude,
                lon: longitude,
                exclude: "current,minutely,hourly,daily", // Chỉ lấy alerts
                appid: OPENWEATHER_API_KEY,
                units: "metric", // Đơn vị mét (Celsius)
                lang: "vi", // Ngôn ngữ tiếng Việt
            },
        });

        const data = response.data;

        if (data.alerts && data.alerts.length > 0) {
            let alertMessages = [`Cảnh báo thời tiết cho khu vực ${locationName}:\n`];
            data.alerts.forEach((alert: any) => {
                const startTime = new Date(alert.start * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                const endTime = new Date(alert.end * 1000).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });
                alertMessages.push(`- **Loại cảnh báo:** ${alert.event}`);
                alertMessages.push(`  **Nguồn:** ${alert.sender_name}`);
                alertMessages.push(`  **Thời gian:** Từ ${startTime} đến ${endTime}`);
                alertMessages.push(`  **Mô tả:** ${alert.description}\n`);
            });
            return alertMessages.join("\n");
        } else {
            return `Hiện tại không có cảnh báo thời tiết đặc biệt nào cho khu vực ${locationName}.`;
        }
    } catch (error) {
        console.error("Lỗi khi gọi OpenWeatherMap One Call API (Alerts):", error);
        if (axios.isAxiosError(error) && error.response) {
            return `Lỗi từ OpenWeatherMap: ${error.response.status} - ${error.response.data.message || 'Không rõ lỗi'}. Vui lòng kiểm tra lại API Key hoặc tên địa điểm.`;
        }
        return `Xin lỗi, tôi gặp sự cố khi lấy cảnh báo thời tiết cho ${locationName}. Vui lòng thử lại sau.`;
    }
}


export const weatherTool = new DynamicStructuredTool({
    name: "get_current_weather", // Đổi tên thành "get_current_weather" để nhất quán với mô tả
    description: "Dùng để lấy dữ liệu thời tiết hiện tại của một địa điểm và lưu trữ vào database. Đầu vào là tên địa điểm (ví dụ: 'Hà Nội'). Trả về thông tin chi tiết về nhiệt độ, mô tả thời tiết, độ ẩm và tốc độ gió.",
    schema: {
        type: "object",
        properties: {
            locationName: { // Đảm bảo tên biến khớp với hàm _getAndStoreWeatherData
                type: "string",
                description: "Tên địa điểm cần lấy thời tiết. Ví dụ: 'Hà Nội'."
            }
        },
        required: ["locationName"],
    } as const,
    func: async (input: { locationName: string }) => {
        // Gọi hàm nội bộ và trả về kết quả
        return getAndStoreWeatherData(input.locationName);
    },
});

export const get_weather_forecast_tool = new DynamicStructuredTool({
    name: "get_weather_forecast",
    description: "Cung cấp thông tin dự báo thời tiết hàng ngày cho một địa điểm cụ thể trong tối đa 5 ngày tới. Công cụ này yêu cầu tên địa điểm và số ngày bạn muốn dự báo. Ví dụ: 'dự báo thời tiết Hà Nội 3 ngày tới'.",
    schema: {
        type: "object",
        properties: {
            locationName: {
                type: "string",
                description: "Tên của địa điểm cần dự báo thời tiết (ví dụ: 'Hà Nội', 'Đà Nẵng', 'Thành phố Hồ Chí Minh').",
            },
            days: {
                type: "number",
                description: "Số ngày muốn dự báo thời tiết, tối đa là 5 ngày (ví dụ: 1, 3, 5).",
                minimum: 1, // Đảm bảo số ngày ít nhất là 1
                maximum: 5, // Giới hạn số ngày tối đa là 5
            },
        },
        required: ["locationName", "days"], // Cả địa điểm và số ngày đều là bắt buộc
    } as const,
    func: async (input: { locationName: string; days: number }) => {
        // Gọi hàm get_weather_forecast của bạn
        return get_weather_forecast(input.locationName, input.days);
    },
});

export const get_all_weather_forecast_tool = new DynamicStructuredTool({
    name: "get_all_weather_forecast",
    description: "Cung cấp **dữ liệu dự báo thời tiết chi tiết theo từng mốc thời gian (3 giờ/lần)** cho một địa điểm cụ thể trong tối đa 5 ngày tới. Công cụ này yêu cầu tên địa điểm bạn muốn dự báo. **Sử dụng công cụ này khi người dùng hỏi về: thời gian cụ thể mưa/nắng, mức độ mưa/nắng, hoặc diễn biến thời tiết chi tiết trong ngày/các ngày tới.**",
    schema: {
        type: "object",
        properties: {
            locationName: {
                type: "string",
                description: "Tên của địa điểm cần dự báo thời tiết (ví dụ: 'Hà Nội', 'Đà Nẵng', 'Thành phố Hồ Chí Minh').",
            },
        },
        required: ["locationName"], // Cả địa điểm và số ngày đều là bắt buộc
    } as const,
    func: async (input: { locationName: string; days: number }) => {
        // Gọi hàm get_weather_forecast của bạn
        return get_all_weather_forecast(input.locationName);
    },
});
