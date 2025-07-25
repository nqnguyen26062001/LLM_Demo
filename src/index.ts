import "reflect-metadata";
import { chatWithGemini ,initializeApp,AppDataSource } from "./tools";
import {testEmbeddingModel} from "./utils/vectorStore";
import { _findNearbyAdministrativeAreas, getCoordinatesForLocation , _getDetailedAddress,getDetailsRouteDirections ,searchPlacesWithNominatim ,getGeographyInfoWithNominatim ,getOpenrouteserviceDirections} from "./tools/locationTool";
import 'dotenv/config';
import {get_weather_forecast ,get_all_weather_forecast ,getWeatherAlerts} from "./tools/weatherTool";
import {getAndStoreNewsCategoryData} from "./tools/newsTool";

// import * as dotenv from 'dotenv';
// dotenv.config(); // Dòng này phải ở đầu file

async function main() {
    console.log("\n--- Bắt đầu các kịch bản tương tác với LLM ---");
await initializeApp(); // Khởi tạo AppDataSource và LLM một lần
    // await chatWithGemini("Tìm hiểu về thành phố Hồ Chí Minh",21.0272256,105.7783808);
    await chatWithGemini("Quãng đường đi từ đây đến Đông Anh có mưa hay không",21.0272256,105.7783808);
    // await chatWithGemini("Khi nào Huế có mưa và mưa trong bao lâu",21.0272256,105.7783808);

    // await chatWithGemini("Cho tôi biết tin tức bão và lũ lụt ở Việt Nam.",21.0272256,105.7783808);
    // await chatWithGemini("chi tiết đường đi từ Đông Anh đến Đại học Sư Phạm Hà Nội ",21.0272256,105.7783808);
        // await chatWithGemini(" thời tiết trên đường ra sao ",21.0272256,105.7783808);

    // await chatWithGemini("từ Lạc Long Quân Hà Nội đi đến Đại Học Quốc Gia Hà Nội đi như thế nào?",21.0272256,105.7783808);
    // await chatWithGemini("thời tiết của Hà Nội trong 2 ngày tới như thế nào",21.0272256,105.7783808);
    // await chatWithGemini("về tin tức lấy 2 bài mới nhất ",21.0272256,105.7783808);
    // await chatWithGemini(" địa điểm hiện tại của tôi ",21.0272256,105.7783808);
    // await chatWithGemini("đường đi từ Lạc Long Quân Hà Nội đến Đại Học Sư Phạm Hà Nội như thế nào",21.0272256,105.7783808);
// 
    // console.log(getAndStoreNewsData("Hà Nội"))
    // console.log(getRouteDirections("Đại học FPT Hà Nội","Đông Anh"))
//   const result = await _getDetailedAddress(21.0272256,105.7783808); // Sử dụng await ở đây
    // const result = await getCoordinatesForLocation("WinMart+, Đường Phạm Hùng, Mỹ Đình 2, Quận Nam Từ Liêm, Hà Nội, 10085, Việt Nam"); // Sử dụng await ở đây
    // const result = await getDetailsRouteDirections("Đông Anh",21.0272256,105.7783808,"Đại học Sư Phạm Hà Nội",0,0,[ { latitude: 21.036785, longitude: 105.834007 }, // Lăng Chủ tịch Hồ Chí Minh (lat, lon)
    //         { latitude: 21.046399, longitude: 105.848805 }  ]); // Sử dụng await
    //  ở đây
    // const result = await get_all_weather_forecast("Đông Anh Hà Nội"); // Sử dụng await ở đây
//    const result = await getAndStoreNewsCategoryData("Hà Nội","công nghệ")

    //     const route = await getDetailsRouteDirections(
    //     undefined, 21.028511, 105.854378, // Hồ Hoàn Kiếm (lat, lon)
    //     undefined, 21.007137, 105.843063, // Đại học Bách Khoa (lat, lon)
    //     [
    //        "Hà Đông Hà Nội",
    //     ]
    // );

        // const result = await getOpenrouteserviceDirections("Đông Anh Thành phố Hà Nội" , "Đại học quốc gia Hà Nội")
    // if (route) {
    //     console.log("Lộ trình qua điểm trung gian (ví dụ 2):", route);
    // } else {
    //     console.log("Không tìm thấy lộ trình.");
    // }

    // console.log(result);
    // testEmbeddingModel();
        process.on('SIGINT', async () => {
        if (AppDataSource.isInitialized) {
            await AppDataSource.destroy();
            console.log('Data Source has been closed on application shutdown.');
        }
        process.exit(0);
    });

    console.log("\n--- Kết thúc các kịch bản tương tác với LLM ---");
}

main().catch(async (error) => {
    console.error("Lỗi chính trong ứng dụng:", error);
    process.exit(1);
});