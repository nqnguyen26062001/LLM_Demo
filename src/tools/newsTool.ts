// src/tools/newsTool.ts
import axios from 'axios';
import prisma from '../libs/prisma';
import { getCoordinatesForLocation } from './locationTool'; // Import để lấy locationId
import { DynamicStructuredTool,DynamicStructuredToolInput } from "@langchain/core/tools";

const GNEWS_API_URL = process.env.GNEWS_API_URL || 'https://gnews.io/api/v4/search';
const GNEWS_API_KEY = process.env.GNEWS_API_KEY; // Bạn cần đặt biến môi trường này!

interface GNewsArticle {
    title: string;
    description: string;
    content: string;
    url: string;
    image: string;
    publishedAt: string; // ISO 8601 string
    source: {
        name: string;
        url: string;
    };
    category : string;
}

interface GNewsApiResponse {
    totalArticles: number;
    articles: GNewsArticle[];
}

/**
 * Tìm kiếm và lưu trữ dữ liệu tin tức mới nhất dựa trên một địa điểm.
 * Ưu tiên kiểm tra database trước khi gọi GNews.io API.
 * @param locationName Tên địa điểm cần tìm tin tức (ví dụ: "Hà Nội").
 * @param numArticles Số lượng bài báo tối đa muốn lấy (mặc định là 5).
 * @returns Mảng các đối tượng tin tức hoặc null nếu không tìm thấy.
 */
export async function getAndStoreNewsLocationData(
    locationName: string,
    numArticles: number = 5
): Promise<any | undefined> {
    if (!GNEWS_API_KEY) {
        console.error("[NewsTool] GNEWS_API_KEY is not set in environment variables.");
        return "Lỗi: Khóa API GNews.io chưa được cấu hình.";
    }

    try {
         const locationData = await getCoordinatesForLocation(locationName);
         if (!locationData) {
         console.warn(`[NewsTool] Could not find coordinates for location: ${locationName}. Cannot fetch news.`);
         return `Không tìm thấy thông tin địa điểm cho '${locationName}'.`;

         }
        // Bước 2: Kiểm tra database để tìm tin tức mới nhất cho địa điểm này
        // Chúng ta có thể định nghĩa "mới nhất" bằng cách tìm các bài báo được xuất bản gần đây
        // Hoặc kiểm tra xem có tin tức nào được lấy gần đây không (ví dụ trong 1 giờ qua)
        const CACHE_VALIDITY_MINUTES = 60;
        const cacheValidThreshold = new Date(Date.now() - CACHE_VALIDITY_MINUTES * 60 * 1000);

         const cachedNews = await prisma.newsArticle.findMany({
            where: {
                locationId: locationData.id,
                createdAt: {

                    gte: cacheValidThreshold,
            },
             },
             orderBy: {
                publishedAt: 'desc'
                },
                take: numArticles,
                select: {
                title: true,
                url: true,
                description: true,
                image: true,
                publishedAt: true,
                sourceName: true,
                sourceUrl: true         
                }

        });

      if (cachedNews && cachedNews.length > 0) {
            console.log(`[NewsTool] Found ${cachedNews.length} cached news articles for "${locationName }".`);
            const newsSummary = cachedNews.map(news =>
                `- **${news.title}** (${news.sourceName || 'Không rõ nguồn'}) - ${news.url}`
            ).join('\n');
            return `Tìm thấy ${cachedNews.length} bài tin tức gần đây cho **${ locationData.displayName}** (từ cache):\n${newsSummary}`;
        }
        console.log(`[NewsTool] No recent news found for "${locationName }" in DB. Calling GNews.io API...`);

        const gnewsQueryParam =  locationName; // Ưu tiên query, nếu không có thì dùng locationName
        if (!gnewsQueryParam) {
            return "Không có từ khóa hoặc địa điểm để tìm kiếm tin tức trên GNews.io.";
        }


        const encodedQuery = encodeURIComponent(gnewsQueryParam);
        const finalQuery = gnewsQueryParam.includes(' ') ? `"${gnewsQueryParam}"` : gnewsQueryParam;


        // Bước 3: Gọi GNews.io API
        const response = await axios.get<GNewsApiResponse>(GNEWS_API_URL, {
            params: {
                q: finalQuery, // Tìm kiếm tin tức liên quan đến địa điểm
                lang: 'vi',      // Ngôn ngữ tiếng Việt
                country: 'vn',   // Lấy tin tức từ Việt Nam (nếu có thể)
                max: numArticles, // Số lượng bài báo tối đa
                apikey: GNEWS_API_KEY,
            }
        });

        const articles = response.data.articles;
        console.log(articles);
        if (articles && articles.length > 0) {
            console.log(`[NewsTool] Fetched ${articles.length} new articles for "${locationName}" from GNews.io.`);

            const newsToSave = articles.map(article => ({
                locationId: locationData.id,
                title: article.title,
                url: article.url,
                image: article.image || null,
                description: article.description || null,
                content: article.content || null,
                publishedAt: new Date(article.publishedAt),
                sourceName: article.source.name || null,
                sourceUrl: article.source.url || null,
            }));

            // Bước 4: Lưu trữ dữ liệu tin tức vào database
            // Sử dụng upsert hoặc createMany để tránh trùng lặp dựa trên URL
            const savedNewsSummary: string[] = [];

            const savedNews = [];
            for (const item of newsToSave) {
                try {
                    const newsRecord = await prisma.newsArticle.upsert({
                        where: { url: item.url }, // URL là duy nhất
                        update: {
                            locationId: locationData.id,
                            title: item.title,
                            description: item.description,
                            image: item.image,
                            content: item.content,
                            publishedAt: item.publishedAt,
                            sourceName: item.sourceName,
                            sourceUrl: item.sourceUrl,
                        },
                        create: item,
                        select: {
                            title: true,
                            url: true,
                            description: true,
                            image: true,
                            publishedAt: true,
                            sourceName: true,
                            sourceUrl: true
                        }
                    });
                    savedNewsSummary.push(`- **${newsRecord.title}** (${newsRecord.sourceName || 'Không rõ nguồn'}) - ${newsRecord.url}`);

                    savedNews.push(newsRecord);
                } catch (dbError: any) {
                    // Xử lý lỗi nếu có bài báo nào đó không thể lưu (ví dụ: URL quá dài)
                    console.error(`[NewsTool] Failed to save news article ${item.url}:`, dbError.message);
                }
            }
                if (savedNewsSummary.length > 0) {
                 return `Tìm thấy ${savedNewsSummary.length} bài tin tức mới nhất cho **${locationName}**:\n${savedNewsSummary.join('\n')}`;
            } else {
                 return `Không có bài tin tức nào mới cho **${locationName}** được tìm thấy hoặc lưu trữ.`;
            }
            // return savedNews;
        }

        // return null; // Không tìm thấy bài báo nào
    } catch (error: any) {
        console.error(`[NewsTool] Error fetching or storing news for "${locationName}":`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[NewsTool] GNews.io API Error Response:`, error.response.data);
        }
        return `Có lỗi xảy ra khi tìm tin tức cho ${locationName}.`;
    }
}

/**
 * Tìm kiếm và lưu trữ dữ liệu tin tức mới nhất dựa trên một địa điểm.
 * Ưu tiên kiểm tra database trước khi gọi GNews.io API.
 * @param locationName Tên địa điểm cần tìm tin tức (ví dụ: "Hà Nội").
 * @param numArticles Số lượng bài báo tối đa muốn lấy (mặc định là 5).
 * @param category Danh mục yêu cầu của bài báo.
 * @returns Mảng các đối tượng tin tức hoặc null nếu không tìm thấy.
 */
export async function getAndStoreNewsCategoryData(
    locationName: string,
    category : string ,
    numArticles: number = 5
): Promise<any | undefined> {
    if (!GNEWS_API_KEY) {
        console.error("[NewsTool] GNEWS_API_KEY is not set in environment variables.");
        return "Lỗi: Khóa API GNews.io chưa được cấu hình.";
    }

    try {
        const locationData = await getCoordinatesForLocation(locationName);
         if (!locationData) {
         console.warn(`[NewsTool] Could not find coordinates for location: ${locationName}. Cannot fetch news.`);
         return `Không tìm thấy thông tin địa điểm cho '${locationName}'.`;

         }
        // Bước 2: Kiểm tra database để tìm tin tức mới nhất cho địa điểm này
        // Chúng ta có thể định nghĩa "mới nhất" bằng cách tìm các bài báo được xuất bản gần đây
        // Hoặc kiểm tra xem có tin tức nào được lấy gần đây không (ví dụ trong 1 giờ qua)
        const CACHE_VALIDITY_MINUTES = 60;
        const cacheValidThreshold = new Date(Date.now() - CACHE_VALIDITY_MINUTES * 60 * 1000);

         const cachedNews = await prisma.newsArticle.findMany({
            where: {
                locationId: locationData.id,
                createdAt: {

                    gte: cacheValidThreshold,
            },
             },
             orderBy: {
                publishedAt: 'desc'
                },
                take: numArticles,
                select: {
                title: true,
                url: true,
                description: true,
                image: true,
                publishedAt: true,
                sourceName: true,
                sourceUrl: true ,
                category : true
                }

        });

      if (cachedNews && cachedNews.length > 0) {
            console.log(`[NewsTool] Found ${cachedNews.length} cached news articles for "${locationName }".`);
            const newsSummary = cachedNews.map(news =>
                `- **${news.title}** (${news.sourceName || 'Không rõ nguồn'}) - ${news.url}`
            ).join('\n');
            return `Tìm thấy ${cachedNews.length} bài tin tức ${category} gần đây cho **${ locationData.displayName}** (từ cache):\n${newsSummary}`;
        }
        console.log(`[NewsTool] No recent news found for "${locationName }" in DB. Calling GNews.io API...`);

        const gnewsQueryParam =  locationName; // Ưu tiên query, nếu không có thì dùng locationName
        if (!gnewsQueryParam) {
            return "Không có từ khóa hoặc địa điểm để tìm kiếm tin tức trên GNews.io.";
        }


        const encodedQuery = encodeURIComponent(gnewsQueryParam);
        const finalQuery = gnewsQueryParam.includes(' ') ? `"${gnewsQueryParam}"` : gnewsQueryParam;
        const finalCategory = gnewsQueryParam.includes(' ') ? `"${category}"` : category;


        // Bước 3: Gọi GNews.io API
        const response = await axios.get<GNewsApiResponse>(GNEWS_API_URL, {
            params: {
                q: finalQuery, // Tìm kiếm tin tức liên quan đến địa điểm
                lang: 'vi',      // Ngôn ngữ tiếng Việt
                country: 'vn',   // Lấy tin tức từ Việt Nam (nếu có thể)
                max: numArticles, // Số lượng bài báo tối đa
                apikey: GNEWS_API_KEY,
                category: finalCategory
            }
        });

        const articles = response.data.articles;
        console.log(articles);
        if (articles && articles.length > 0) {
            console.log(`[NewsTool] Fetched ${articles.length} new articles for "${locationName}" from GNews.io.`);

            const newsToSave = articles.map(article => ({
                locationId: locationData.id,
                title: article.title,
                url: article.url,
                image: article.image || null,
                description: article.description || null,
                content: article.content || null,
                publishedAt: new Date(article.publishedAt),
                sourceName: article.source.name || null,
                sourceUrl: article.source.url || null,
                category: category, // Store the category with the article

            }));

            // Bước 4: Lưu trữ dữ liệu tin tức vào database
            // Sử dụng upsert hoặc createMany để tránh trùng lặp dựa trên URL
            const savedNewsSummary: string[] = [];

            // const savedNews = [];
            // for (const item of newsToSave) {
            //     try {
            //         const newsRecord = await prisma.newsArticle.upsert({
            //             where: { url: item.url }, // URL là duy nhất
            //             update: {
            //                 locationId: locationData.id,
            //                 title: item.title,
            //                 description: item.description,
            //                 image: item.image,
            //                 content: item.content,
            //                 publishedAt: item.publishedAt,
            //                 sourceName: item.sourceName,
            //                 sourceUrl: item.sourceUrl,
            //                 category: item.category,
            //             },
            //             create: item,
            //             select: {
            //                 title: true,
            //                 url: true,
            //                 description: true,
            //                 image: true,
            //                 publishedAt: true,
            //                 sourceName: true,
            //                 sourceUrl: true
            //             }
            //         });
            //         savedNewsSummary.push(`- **${newsRecord.title}** (${newsRecord.sourceName || 'Không rõ nguồn'}) - ${newsRecord.url}`);

            //         savedNews.push(newsRecord);
                    
            //     } catch (dbError: any) {
            //         // Xử lý lỗi nếu có bài báo nào đó không thể lưu (ví dụ: URL quá dài)
            //         console.error(`[NewsTool] Failed to save news article ${item.url}:`, dbError.message);
            //     }
            // }
                        // Save news articles concurrently
            const upsertPromises = newsToSave.map(item =>
                prisma.newsArticle.upsert({
                    where: { url: item.url }, // URL là duy nhất
                    update: {
                        locationId: item.locationId, // Update locationId too if needed
                        title: item.title,
                        description: item.description,
                        image: item.image,
                        content: item.content,
                        publishedAt: item.publishedAt,
                        sourceName: item.sourceName,
                        sourceUrl: item.sourceUrl,
                        category: item.category, // Update category if it can change
                    },
                    create: item,
                    select: {
                        title: true, url: true, description: true, image: true,
                        publishedAt: true, sourceName: true, sourceUrl: true
                    }
                })
            );
            const savedResults = await Promise.allSettled(upsertPromises);
            let successfulSaves = 0;

            savedResults.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    savedNewsSummary.push(`- **${result.value.title}** (${result.value.sourceName || 'Không rõ nguồn'}) - ${result.value.url}`);
                    successfulSaves++;
                } else {
                    const failedItemUrl = newsToSave[index]?.url || 'N/A';
                    console.error(`[NewsTool] Failed to save news article ${failedItemUrl}:`, result.reason);
                }
            });
                if (savedNewsSummary.length > 0) {
                 return `Tìm thấy ${savedNewsSummary.length} bài tin tức ${category} mới nhất cho **${locationName}**:\n${savedNewsSummary.join('\n')}`;
            } else {
                 return `Không có bài tin tức nào mới cho **${locationName}** được tìm thấy hoặc lưu trữ.`;
            }
            // return savedNews;
        }

        // return null; // Không tìm thấy bài báo nào
    } catch (error: any) {
        console.error(`[NewsTool] Error fetching or storing news for "${locationName}":`, error.message);
        if (axios.isAxiosError(error) && error.response) {
            console.error(`[NewsTool] GNews.io API Error Response:`, error.response.data);
        }
        return `Có lỗi xảy ra khi tìm tin tức cho ${locationName}.`;
    }
}



export const newsLocationTool = new DynamicStructuredTool({
    name: "getAndStoreNewsLocationData",
    description: "Tìm kiếm và lưu trữ các bài tin tức mới nhất liên quan đến một địa điểm cụ thể. Nó ưu tiên kiểm tra dữ liệu tin tức gần đây trong database trước, và nếu không tìm thấy hoặc đã cũ, nó sẽ lấy dữ liệu từ GNews.io API và lưu trữ. Trả về danh sách các tiêu đề tin tức, nguồn và URL.",
    schema: {
        type: "object",
        properties: {
            locationName: {
                type: "string",
                description: "Tên của địa điểm cần tìm tin tức (ví dụ: 'Thành phố Hồ Chí Minh', 'Đông Anh', 'Hà Nội')."
            },
            numArticles: {
                type: "number",
                description: "Số lượng bài viết tối đa cần lấy (mặc định là 5). API GNews.io giới hạn tối đa là 50.",
            }
        },
         required: ["locationName"],


    } as const,
        func: async (input: { locationName: string; numArticles?: number }) => {

        // Đảm bảo hàm func gọi hàm getAndStoreNewsData với các tham số đúng
        return getAndStoreNewsLocationData(input.locationName, input.numArticles);
    },
});


export const newsCategoryTool = new DynamicStructuredTool({
    name: "getAndStoreNewsCategoryData",
    description: "Tìm kiếm và lưu trữ các bài tin tức mới nhất liên quan đến một địa điểm cụ thể. Nó ưu tiên kiểm tra dữ liệu tin tức gần đây trong database trước, và nếu không tìm thấy hoặc đã cũ, nó sẽ lấy dữ liệu từ GNews.io API và lưu trữ. Trả về danh sách các tiêu đề tin tức, nguồn và URL.",
    schema: {
        type: "object",
        properties: {
            locationName: {
                type: "string",
                description: "Tên của địa điểm cần tìm tin tức (ví dụ: 'Thành phố Hồ Chí Minh', 'Đông Anh', 'Hà Nội')."
            },
            category: {
                type: "string",
                description: "Tên của danh muc cần tìm tin tức (ví dụ: chung , thế giới , quốc gia , kinh doanh , công nghệ , giải trí , thể thao , khoa học và sức khỏe)."
            },
            numArticles: {
                type: "number",
                description: "Số lượng bài viết tối đa cần lấy (mặc định là 5). API GNews.io giới hạn tối đa là 50.",
            }
        },
         required: ["category","locationName"],


    } as const,
        func: async (input: { locationName: string; numArticles?: number, category : string  }) => {

        return getAndStoreNewsCategoryData(input.locationName, input.category  ,input.numArticles );
    },
});
