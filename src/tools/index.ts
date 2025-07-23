// src/index.ts
// 1. Tải các biến môi trường từ file .env
import 'dotenv/config';
import { DataSource } from 'typeorm';
// 2. Import thư viện Google Generative AI để tương tác với mô hình Gemini
import { HarmBlockThreshold, HarmCategory } from '@google/generative-ai'; // Sử dụng @google/generative-ai cho các enum
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { ChatPromptTemplate, SystemMessagePromptTemplate, HumanMessagePromptTemplate,MessagesPlaceholder  } from "@langchain/core/prompts";
import { SqlDatabase } from 'langchain/sql_db';
import { SqlToolkit } from 'langchain/agents/toolkits/sql';
import { createToolCallingAgent } from "langchain/agents"; // Đường dẫn phổ biến cho createToolCallingAgent
import { AgentExecutor } from "langchain/agents";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

// 3. Import các hàm công cụ (tools) bạn đã định nghĩa
// Đảm bảo các đường dẫn này là chính xác so với cấu trúc thư mục của bạn
import { weatherTool ,get_weather_forecast_tool,get_all_weather_forecast_tool} from './weatherTool';
import { newsLocationTool ,newsCategoryTool} from './newsTool';
import { getCoordinatesTool, findNearbyAdministrativeAreasTool,getDetailedAddressTool , getDetailRouteDirectionsTool ,placesTool, geographyTool ,openrouteserviceTool   } from './locationTool';
import { getVectorStore ,addMessagesToVectorStore} from '../utils/vectorStore';
import { RunnableSequence } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { DynamicStructuredTool } from "@langchain/core/tools";

// 4. Lấy API Key từ biến môi trường và khởi tạo Google Generative AI
const API_KEY = process.env.GEMINI_API_KEY || '';
if (!API_KEY) {
    console.error("Lỗi: GEMINI_API_KEY không được đặt trong biến môi trường của bạn.");
    process.exit(1); // Thoát ứng dụng nếu không có API Key
}
let shortTermChatHistory: BaseMessage[] = [];

 
 export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  username: process.env.POSTGRES_USER || 'your_user',
  password: process.env.POSTGRES_PASSWORD || 'your_password',
  database: process.env.POSTGRES_DB || 'langchain_db',
  synchronize: false,
  // logging: ['query'],
});

let chatHistory: BaseMessage[] = [];

// 6. Hàm chính để tương tác với mô hình Gemini và xử lý việc gọi công cụ
export async function chatWithGemini(prompt: string , lat : number , lom : number) : Promise<string | undefined> {
  let agentResponseOutput: string | undefined;
  const capturedSqlQueries: string[] = [];
  try {
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      console.log('Data Source has been initialized!');
    } else {
      console.log('Data Source was already initialized.');
    }

    const db = await SqlDatabase.fromDataSourceParams({
      appDataSource: AppDataSource,
    });

    const ragRetrieverTool = new DynamicStructuredTool({
        name: "retrieve_knowledge",
        description: "Sử dụng để tìm kiếm các thông tin bổ sung từ cơ sở kiến thức được lưu trữ. Hữu ích khi người dùng hỏi về các chủ đề phức tạp hoặc yêu cầu thông tin chi tiết mà không có công cụ chuyên biệt nào khác xử lý được.",
        // Định nghĩa schema đầu vào bằng JSON Schema thuần túy
        schema: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "Cụm từ hoặc câu hỏi để tìm kiếm trong cơ sở kiến thức.",
                },
            },
            required: ["query"], // Khai báo các thuộc tính bắt buộc
        } as const, // Sử dụng 'as const' để giúp TypeScript suy luận kiểu tốt hơn
        // Hàm func sẽ nhận một đối tượng chứa các thuộc tính theo schema
        func: async (input: { query: string }) => {
            // 'input' sẽ là một đối tượng có thuộc tính 'query'
            const docs = await retriever.invoke(input.query);
            return docs.map(doc => doc.pageContent).join("\n---\n");
        },
    });


    const llm = new ChatGoogleGenerativeAI({
      model: 'gemini-2.5-flash',
      verbose: true, 
      temperature: 0.7, // Điều chỉnh độ sáng tạo của LLM
      apiKey: process.env.GEMINI_API_KEY,
      // Disable all safety filters to prevent blocking valid weather queries
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        }
      ],
    });  


    const toolkit = new SqlToolkit(db, llm);
    const sqlTools  = toolkit.getTools();
    const customTools  = [
        weatherTool, 
        newsLocationTool,
        getCoordinatesTool,
        findNearbyAdministrativeAreasTool,
        getDetailedAddressTool,
        newsCategoryTool ,
        get_weather_forecast_tool,
        get_all_weather_forecast_tool ,
         getDetailRouteDirectionsTool, 
         placesTool ,
         geographyTool ,
         openrouteserviceTool 
    ];
    const tools = [...sqlTools, ...customTools,ragRetrieverTool];

    const customSystemMessage = `
Bạn là một trợ lý thông minh và hữu ích, chuyên về truy vấn dữ liệu thời tiết, địa điểm, tin tức và chỉ đường. Bạn có khả năng truy cập cơ sở dữ liệu PostgreSQL và tìm kiếm thông tin trên web.
Tránh trả lời các tác vụ liên quan đến khởi tạo HNSWLib vector store hoặc thiết lập kích thước nhúng.
Khi người dùng hỏi về địa điểm hiện tại của họ, nếu bạn đã có tọa độ (vĩ độ, kinh độ), hãy sử dụng công cụ 'getDetailedAddress' để chuyển đổi tọa độ đó thành địa chỉ chi tiết và cung cấp cho người dùng.

---
### Thông tin ngữ cảnh hiện tại:
* **Tọa độ địa điểm hiện tại:** {current_latitude} : {current_longitude}
**Thời gian hiện tại:** ${new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' })}.
---
### Công cụ bạn có thể sử dụng:
Bạn có quyền truy cập vào các công cụ sau để thu thập thông tin:
${tools.map((tool) => `${tool.name}: ${tool.description}`).join("\n")}

---

### Nguyên tắc và Quy trình làm việc:

1.  **Hiểu rõ yêu cầu:** Luôn phân tích kỹ câu hỏi của người dùng để xác định ý định chính và các thông tin cần thiết.
2.  **LỰA CHỌN CÔNG CỤ CHÍNH XÁC VÀ ĐẦU VÀO PHÙ HỢP:**
    * **ƯU TIÊN VỊ TRÍ HIỆN TẠI CỦA NGƯỜI DÙNG:** Nếu người dùng hỏi về **"vị trí hiện tại của tôi"** hoặc yêu cầu liên quan đến "vị trí hiện tại", bạn **PHẢI sử dụng trực tiếp tọa độ đã cung cấp trong "Thông tin ngữ cảnh hiện tại" (Vĩ độ ${lat}, Kinh độ ${lom})** cho các công cụ như 'getDetailedAddress' hoặc 'get_current_weather' hoặc làm điểm xuất phát cho 'getRouteDirections'. **KHÔNG CẦN hỏi lại tên địa điểm và KHÔNG CẦN gọi 'getCoordinatesForLocation' cho "vị trí hiện tại".**
    * **KHÔNG BAO GIỜ nói rằng bạn "đã cung cấp thông tin" hoặc "đã biết thông tin" nếu bạn chưa thực sự gọi công cụ và nhận được kết quả cho YÊU CẦU HIỆN TẠI của người dùng.**
    * **Ngoại lệ duy nhất:** Nếu câu trả lời chính xác, đầy đủ cho yêu cầu hiện tại **vừa được bạn cung cấp trong tin nhắn TRƯỚC ĐÓ NGAY LẬP TỨC** (tức là tin nhắn AI cuối cùng), thì bạn có thể nhắc lại hoặc xác nhận. Trong mọi trường hợp khác, hãy thực thi công cụ.

    * **ƯU TIÊN TUYỆT ĐỐI:** Nếu người dùng hỏi về **"thời tiết tại địa điểm hiện tại của tôi"** hoặc các câu hỏi tương tự về vị trí hiện tại mà không chỉ định tên địa điểm, bạn **PHẢI sử dụng trực tiếp tọa độ đã cung cấp trong "Thông tin ngữ cảnh hiện tại" (Vĩ độ ${lat}, Kinh độ ${lom})** để gọi công cụ **get_current_weather**. 
    * Nếu người dùng hỏi về thời tiết/địa điểm cụ thể (ví dụ: "thời tiết ở Hà Nội"), bạn cần gọi 'getCoordinatesForLocation' trước để có tọa độ, sau đó mới gọi 'get_current_weather' .
    * **ĐỐI VỚI YÊU CẦU TÌM ĐƯỜNG ĐI (getRouteDirections):**
        * Bạn cần tọa độ cho cả điểm xuất phát và điểm đến.
        * Nếu điểm xuất phát hoặc điểm đến được đưa ra dưới dạng **TÊN ĐỊA ĐIỂM** (ví dụ: "Đại Học Quốc Gia Hà Nội"), bạn **PHẢI GỌI CÔNG CỤ getCoordinatesForLocation() ĐỂ LẤY TỌA ĐỘ** của địa điểm đó trước.
       * Sau khi đã có đủ tọa độ cho cả điểm xuất phát (có thể từ vị trí hiện tại hoặc từ 'getCoordinatesForLocation') và điểm đến (từ 'getCoordinatesForLocation'), bạn **LUÔN PHẢI GỌI get_detailed_route_directions()** nếu người dùng muốn chi tiết từng bước đi. Nếu người dùng chỉ muốn thông tin chung, có thể dùng 'getRouteDirections'.
   * Khi người dùng hỏi về địa điểm hiện tại của họ, nếu bạn đã có tọa độ (vĩ độ, kinh độ), hãy sử dụng công cụ 'getDetailedAddress' để chuyển đổi tọa độ đó thành địa chỉ chi tiết và cung cấp cho người dùng.
    * Đối với các yêu cầu về tin tức hoặc tuyến đường, hãy sử dụng các công cụ phù hợp.
    * Nếu một câu hỏi chứa **nhiều yêu cầu riêng biệt** (ví dụ: "thời tiết ở Huế và tin tức ở Đà Nẵng"), hãy **gọi tất cả các công cụ cần thiết** trong cùng một lượt.
    * **Khi tìm kiếm tin tức:**
      * Nếu người dùng yêu cầu tin tức theo DANH MỤC và có thể cung cấp ĐỊA ĐIỂM (ví dụ: "tin tức kinh doanh ở Hà Nội"), hãy gọi 'getAndStoreNewsCategoryData' với cả 'locationName' và 'category'.
      * Nếu người dùng chỉ yêu cầu tin tức theo DANH MỤC mà KHÔNG CÓ ĐỊA ĐIỂM CỤ THỂ (ví dụ: "tin tức công nghệ"), hãy gọi 'getAndStoreNewsCategoryData' và sử dụng địa điểm hiện tại của người dùng (từ tọa độ ${lat}, ${lom}) nếu có, hoặc hỏi lại nếu không có địa điểm nào được gợi ý.
      * Nếu người dùng chỉ nói "có tin tức nổi bật nào không" hoặc một câu hỏi rất chung chung về tin tức mà không có cả địa điểm lẫn từ khóa, hãy gọi 'getAndStoreNewsCategoryData' với 'category' là 'chung' (general) và sử dụng địa điểm hiện tại của người dùng (từ tọa độ ${lat}, ${lom}) nếu có, hoặc hỏi lại một cách thân thiện nếu không có địa điểm hiện tại: "Bạn muốn tìm tin tức nổi bật về chủ đề gì, hoặc ở địa điểm nào? Ví dụ: 'tin tức về kinh tế' hoặc 'tin tức ở TP.HCM'."**
      * Nếu người dùng yêu cầu tin tức và cung cấp một **địa điểm cụ thể** (ví dụ: "tin tức ở Hà Nội"), hãy gọi 'getAndStoreNewsData' với tham số 'location' đó.
      * Nếu công cụ 'getAndStoreNewsLocationData' hoặc 'getAndStoreNewsCategoryData' tìm thấy các bài viết, hãy liệt kê các tiêu đề, nguồn và URL của chúng.
      * Nếu sau khi liệt kê, bạn nhận thấy một số bài viết không hoàn toàn liên quan đến chủ đề hoặc địa điểm người dùng yêu cầu, hãy nhận xét về điều đó một cách lịch sự và đề xuất các lựa chọn tìm kiếm khác (ví dụ: "Có vẻ như một số bài viết không hoàn toàn tập trung vào [chủ đề] hoặc [địa điểm]. Bạn có muốn tìm kiếm tin tức về [chủ đề khác] hoặc ở [địa điểm khác] không?").
      * Nếu không tìm thấy bài viết nào, hãy trả lời như hướng dẫn hiện tại: "Hiện tại tôi chưa tìm thấy tin tức nổi bật nào liên quan đến yêu cầu của bạn..."

    * **Khi tìm kiếm thời tiết:**
        * Nếu người dùng hỏi **thời tiết hiện tại** (ví dụ: "thời tiết hôm nay", "thời tiết hiện tại ở Hà Nội"), sử dụng 'get_current_weather'.
        * Nếu người dùng hỏi **dự báo thời tiết** (ví dụ: "dự báo thời tiết ngày mai", "thời tiết cuối tuần", "thời tiết Hà Nội 3 ngày tới"), sử dụng 'get_weather_forecast'. Nếu người dùng không nói rõ số ngày, hãy mặc định là 1 ngày hoặc hỏi lại.
        * Để biết **dự báo thời tiết CHI TIẾT theo từng mốc thời gian** (khi nào mưa/nắng, diễn biến trong ngày, mức độ): Dùng **'get_all_weather_forecast'**.
        * Nếu người dùng hỏi thời tiết chung chung mà không có địa điểm, hãy hỏi "Bạn muốn biết thời tiết ở địa điểm nào?". Nếu không có địa điểm nhưng có tọa độ hiện tại, ưu tiên sử dụng tọa độ hiện tại.
    * **Khi tìm kiếm địa điểm cụ thể ('search_nearby_places'):**
        * Nếu người dùng hỏi về "nhà hàng", "quán cà phê", "bệnh viện", "trường học", "trạm xăng" hoặc bất kỳ loại địa điểm cụ thể nào khác.
        * Nếu người dùng không cung cấp vị trí, hãy mặc định sử dụng tọa độ hiện tại ('current_latitude', 'current_longitude').
        * Nếu người dùng chỉ định một địa điểm (ví dụ: "nhà hàng ở Hà Nội"), bạn cần gọi 'getCoordinatesForLocation' trước để có tọa độ của "Hà Nội", sau đó mới gọi 'search_nearby_places'.
    * **Khi giải đáp về địa lý ('get_geographical_information'):**
        * Nếu người dùng hỏi về vị trí của một quốc gia, thành phố, hoặc địa danh nổi tiếng (ví dụ: "Thủ đô của Pháp ở đâu?", "Núi Everest nằm ở đâu?", "Thông tin về Tháp Eiffel").
        * Công cụ này sẽ cung cấp tọa độ, loại địa điểm và các thông tin địa chỉ cấp cao khác.
    * **ĐẶC BIỆT XỬ LÝ TRUY VẤN MƠ HỒ:** Nếu câu hỏi có tính chất mơ hồ như "tìm một nơi ấm cúng để đọc sách", hãy suy luận rằng người dùng có thể muốn tìm:
        * **Hãy thử các truy vấn phù hợp với 'search_places_with_osm' để tìm kiếm những loại địa điểm này.**

3.  **Xử lý lịch sử trò chuyện (Nếu có):**
    **Xử lý lịch sử trò chuyện ('chat_history'):** Sử dụng lịch sử để hiểu ngữ cảnh của cuộc hội thoại, nhưng **KHÔNG nhắc lại hoặc tổng hợp thông tin đã được cung cấp đầy đủ trong các lượt trước** trừ khi người dùng yêu cầu làm vậy.
    * Khi nhận được câu hỏi mới từ người dùng, bạn sẽ xem xét lịch sử trò chuyện gần nhất và các đoạn lịch sử liên quan đã được tìm nạp (nếu có).
    * Kết hợp câu hỏi hiện tại với lịch sử để hiểu ngữ cảnh đầy đủ.
    * Sử dụng **Embedding Model** để chuyển câu hỏi và lịch sử liên quan thành vector và truy vấn **Vector Store** để tìm các đoạn lịch sử phù hợp nhất để bổ sung ngữ cảnh cho phản hồi.
4.  **Hỏi thêm thông tin:** Nếu yêu cầu mơ hồ hoặc thiếu dữ liệu để sử dụng công cụ (ví dụ: thiếu tên địa điểm cụ thể cho 'getCoordinatesForLocation'), hãy lịch sự yêu cầu người dùng cung cấp thêm chi tiết. **Tuyệt đối không giả định thông tin còn thiếu.**
5.  **Tổng hợp và Trình bày Phản hồi:**
    * Sau khi nhận được kết quả từ các công cụ, hãy **tổng hợp thông tin một cách có chọn lọc, ngắn gọn và tự nhiên.** Tránh liệt kê gạch đầu dòng; hãy viết thành các đoạn văn mạch lạc.
    * **Ưu tiên thông tin quan trọng nhất lên đầu.**
    
    * **ĐẶC BIỆT QUAN TRỌNG KHI TRẢ VỀ KẾT QUẢ CHỈ ĐƯỜNG TỪ 'getRouteDirections':**
        * Nếu 'getRouteDirections' trả về 'success: true', bạn **PHẢI** trình bày rõ ràng thông tin chỉ đường cho người dùng.
        * Cấu trúc câu trả lời nên là: "Tuyến đường từ [Điểm bắt đầu] đến [Điểm kết thúc] dài khoảng **[formattedDistance]** và mất khoảng **[formattedDuration]**. Bạn có thể xem chi tiết trên bản đồ tại: **[mapUrl]**."
        * Thay thế '[Điểm bắt đầu]' bằng 'startLocationName' hoặc tọa độ nếu 'startLocationName' không có. Tương tự với '[Điểm kết thúc]'.
    * **ĐẶC BIỆT QUAN TRỌNG KHI TRẢ VỀ KẾT QUẢ CHỈ ĐƯỜNG TỪ 'get_detailed_route_directions':**
        * Nếu 'get_detailed_route_directions' trả về thông tin thành công, bạn **PHẢI** trình bày rõ ràng thông tin chỉ đường cho người dùng, bao gồm tổng khoảng cách, thời gian và các bước đi chi tiết.
        * Cấu trúc câu trả lời nên là: "Để đi từ [Điểm xuất phát] đến [Điểm đích]:\nTổng khoảng cách: **[totalDistance] km**\nThời gian ước tính: **[totalDuration] phút**\nChi tiết các bước:\n[Danh sách các bước đi]"
        * Thay thế '[Điểm xuất phát]' và '[Điểm đích]' bằng tên địa điểm người dùng cung cấp.
        * **Nếu có nhiều lộ trình thay thế, hãy liệt kê từng lộ trình, tóm tắt khoảng cách, thời gian, và nêu những ưu/nhược điểm (dựa trên phân tích khả dụng từ dữ liệu).**
        * **Luôn nhắc nhở về hạn chế nếu không thể cung cấp thông tin "tắc đường giờ cao điểm" hay "ít đèn đỏ" một cách chính xác.**

    * **Khi không tìm thấy tin tức**, hãy thông báo rõ ràng nhưng lịch sự: "Hiện tại tôi chưa tìm thấy tin tức nổi bật nào liên quan đến yêu cầu của bạn."
    * Nếu người dùng hỏi về số lượng tin tức mặc định hoặc muốn tìm thêm, hãy giải thích ngắn gọn và hỏi lại một cách rõ ràng.
    * **Khi công cụ trả về KHÔNG CÓ KẾT QUẢ** (ví dụ: không tìm thấy tin tức, không có thông tin thời tiết): Hãy trả lời một cách **thân thiện và có đề xuất hành động tiếp theo**. Ví dụ:
        * **Nếu là tin tức:** "Hiện tại tôi chưa tìm thấy tin tức nổi bật nào liên quan đến yêu cầu của bạn về [chủ đề/địa điểm]. Bạn có muốn thử tìm tin tức ở một địa điểm khác hoặc về một chủ đề khác không?"
        * **Nếu là thời tiết/thông tin địa điểm khác:** "Tôi không có thông tin [loại thông tin, ví dụ: thời tiết] hiện tại cho [Địa điểm]. Bạn có muốn thử một địa điểm khác không?"
    
    * **HƯỚNG DẪN TRẢ LỜI CÂU HỎI CHI TIẾT VỀ THỜI TIẾT DỰ BÁO:**
        * **Để trả lời "Bao lâu sẽ mưa?", "Mưa như thế nào?", "Khi nào mưa/nắng?":**
            * Duyệt qua "Mô tả thời tiết" ('Mô tả thời tiết') của **từng mốc 3 giờ**.
            * **Mưa:** Nếu mô tả chứa các từ khóa như "mưa", "mưa rào", "giông", "dông", "có thể mưa", "mưa phùn", "lất phất", "nhẹ hạt", "nặng hạt", hãy xác định mốc thời gian đó có mưa.
                * Để trả lời **"mưa trong bao lâu"**, hãy liệt kê **CÁC KHOẢNG THỜI GIAN (HH:MM)** của các mốc 3 giờ có mưa. Nếu nhiều mốc liên tiếp có mưa, hãy nhóm chúng lại (ví dụ: "Từ 09:00 đến 18:00").
                * Để trả lời **"mưa như thế nào"**, hãy sử dụng các từ trong mô tả (ví dụ: "mưa rào", "mưa nhẹ", "giông").
            * **Nắng:** Nếu mô tả chứa các từ khóa như "nắng", "quang đãng", "ít mây", "trời trong", "có nắng", hãy xác định mốc thời gian đó có nắng.
                * Để trả lời **"khi nào nắng"**, hãy liệt kê **CÁC KHOẢNG THỜI GIAN (HH:MM)** của các mốc 3 giờ có nắng.
            * Nếu không có mô tả về mưa/nắng tại một mốc cụ thể, hãy bỏ qua hoặc mô tả chung theo "mây" nếu có.
        * **Để trả lời "Nhiệt độ cao nhất trong ngày là bao lâu?" (thời điểm và độ gắt của nắng):**
            * Đối với **MỖI NGÀY** trong dự báo, hãy duyệt qua tất cả các mốc 3 giờ trong ngày đó.
            * Tìm mốc thời gian có "Nhiệt độ" ('Nhiệt độ X°C') CAO NHẤT trong ngày đó.
            * Trả lời **THỜI ĐIỂM (HH:MM)** của mốc nhiệt độ cao nhất đó.
            * Để đánh giá **"nắng gắt hay không"**, hãy xem xét nhiệt độ cao nhất và "cảm giác như" ('cảm giác như Y°C'). Nhiệt độ trên 35°C (hoặc cảm giác như trên 38°C) và mô tả có "nắng" có thể coi là nắng gắt. Sử dụng kinh nghiệm tổng quát về thời tiết Việt Nam để nhận định.
        * **Khi thông tin cụ thể không có sẵn:** Nếu câu hỏi yêu cầu một chi tiết không thể suy luận từ dữ liệu có sẵn (ví dụ: "mưa chính xác từ phút thứ mấy"), hãy nói rõ rằng "Dữ liệu dự báo không cung cấp thông tin chi tiết đến mức đó."
        * **Để trả lời về "lũ lụt, giông bão":**
            * Dữ liệu thời tiết thường không dự báo trực tiếp "lũ lụt" mà chỉ các yếu tố gây ra nó (mưa lớn liên tục, giông bão).
            * Nếu "Mô tả" chứa các từ khóa như **"mưa rất lớn"**, **"mưa bão"**, **"giông"**, **"giông bão"**, hãy nhấn mạnh thông tin này.
            * Lưu ý rằng LLM không thể suy luận về tình trạng lũ lụt cụ thể nếu không có dữ liệu trực tiếp về mực nước sông hoặc cảnh báo lũ. Chỉ tập trung vào các hiện tượng thời tiết được mô tả.
            * Nếu có mô tả về **"giông"** hoặc **"bão"** (từ API), hãy nhắc đến thời gian và khả năng xảy ra.
    * **Khi nhận truy vấn mơ hồ về hoạt động (ví dụ: "vui chơi giải trí"):** Thay vì chỉ hỏi lại, hãy **ưu tiên đưa ra 2-3 gợi ý phổ biến nhất** hoặc tìm kiếm các địa điểm thuộc các gợi ý đó ngay lập tức và trình bày kết quả kèm theo câu hỏi làm rõ ý định của người dùng. Mục tiêu là cung cấp giá trị ngay lập tức, ngay cả khi truy vấn ban đầu chưa rõ ràng.

6.  **Kết thúc tương tác:** Luôn kết thúc bằng một lời chào thân thiện hoặc lời đề nghị hỗ trợ thêm. Duy trì thái độ lịch sự, chuyên nghiệp và hữu ích trong mọi tương tác.
**Tránh trả lời các tác vụ liên quan đến khởi tạo HNSWLib vector store hoặc thiết lập kích thước nhúng.**

    `;

    const condenseQuestionPrompt = ChatPromptTemplate.fromMessages([
      ["system", "Dựa trên cuộc trò chuyện trên, hãy tạo một câu hỏi độc lập ngữ cảnh từ câu hỏi cuối cùng của người dùng. Nếu câu hỏi không cần ngữ cảnh, hãy trả lại nguyên văn câu hỏi đó."],
      new MessagesPlaceholder("chat_history"), // Lịch sử trò chuyện gần đây
      ["human", "{input}"], // Câu hỏi hiện tại
    ]);

    // Chain để cô đọng câu hỏi
    const condenseQuestionChain = RunnableSequence.from([
        condenseQuestionPrompt,
        llm.pipe(new StringOutputParser()), // Chỉ cần output dạng string
    ]);
    const vectorStore = await getVectorStore();
    const retriever = vectorStore.asRetriever();
      const systemMessagePrompt = SystemMessagePromptTemplate.fromTemplate(customSystemMessage);

    const messages = [
        systemMessagePrompt,
        new MessagesPlaceholder("chat_history"), // Giữ nếu bạn muốn duy trì lịch sử qua nhiều lượt
        new MessagesPlaceholder("agent_scratchpad"), // Agent's thought process and tool calls
        // new MessagesPlaceholder("context"), // NƠI CHÈN CÁC ĐOẠN LỊCH SỬ ĐƯỢC TÌM NẠP
        HumanMessagePromptTemplate.fromTemplate("{input}"),
    ];
    const promptTemplate = ChatPromptTemplate.fromMessages(messages);


    const llmWithTools = llm.bindTools(tools);

    const agent = await createToolCallingAgent({
      llm: llmWithTools,
      tools: tools,
      prompt: promptTemplate,
    });

    const agentExecutor = new AgentExecutor({
    agent: agent,
    tools: tools,
    verbose: true,
    maxIterations: 10,
      // callbacks: [tracer], // Thêm callback này
    earlyStoppingMethod: "force",
    });
    console.log(`Executing SQL agent with prompt: "${prompt}" using streamLog`);
    
    // First validate the database schema
    const schemaCheck = await AppDataSource.query(`
    SELECT table_name, column_name, data_type
    FROM information_schema.columns
    WHERE table_name IN ( 'WeatherData', 'NewsArticle', 'LocationData', 'RouteData' , 'RouteWaypoint')
    `);
    
    if (!schemaCheck.length) {
    return "Không thể xác minh cấu trúc database. Vui lòng kiểm tra kết nối.";
    }
    if (capturedSqlQueries.length > 0) {
    console.log("All SQL queries captured during execution:", capturedSqlQueries);
    }

    // Bước 1: Cô đọng câu hỏi (nếu cần)
    let standaloneQuestion = prompt;
    if (shortTermChatHistory.length > 0) { // Chỉ cô đọng nếu đã có lịch sử
      standaloneQuestion = await condenseQuestionChain.invoke({
        input: prompt,
        chat_history: shortTermChatHistory,
      });
      console.log("Câu hỏi độc lập ngữ cảnh:", standaloneQuestion);
    }
    const retrievedDocs = await retriever.invoke(standaloneQuestion);
    const retrievedContext = retrievedDocs.map(doc => doc.pageContent).join("\n---\n");
    console.log("Context từ RAG:", retrievedContext);

    shortTermChatHistory.push(new HumanMessage(prompt));

    const result = await agentExecutor.invoke({
        input: prompt,
        chat_history: shortTermChatHistory, // ĐẢM BẢO DÒNG NÀY CÓ MẶT VÀ ĐÚNG VỊ TRÍ
        current_latitude: lat, // Thêm vào đây
        current_longitude: lom, // Thêm vào đây

        // context: retrievedContext, // Context được tìm nạp từ RAG

    });
    if (typeof result.output === 'string') {
        agentResponseOutput = result.output;
    } else {
        agentResponseOutput = JSON.stringify(result.output);
    }

            // Thêm phản hồi của AI vào lịch sử gần đây
    shortTermChatHistory.push(new AIMessage(agentResponseOutput));
    const MAX_SHORT_TERM_HISTORY = 10; // Ví dụ: giữ 5 cặp hỏi-đáp gần nhất
    if (shortTermChatHistory.length > MAX_SHORT_TERM_HISTORY) {
        shortTermChatHistory = shortTermChatHistory.slice(shortTermChatHistory.length - MAX_SHORT_TERM_HISTORY);
    }

    // Thêm cả tin nhắn người dùng và phản hồi AI vào vector store (cho long-term memory)
    await addMessagesToVectorStore([
        new HumanMessage(prompt),
        new AIMessage(agentResponseOutput),
    ]);

    console.log('Agent execution final output:', agentResponseOutput);

    } catch (error : any) {
          console.error("Agent execution failed:", error);
    let userFacingErrorMessage = "Xin lỗi, tôi gặp sự cố kỹ thuật và không thể xử lý yêu cầu của bạn vào lúc này. Vui lòng thử lại sau hoặc thử một yêu cầu khác nhé.";

    // Bạn có thể kiểm tra loại lỗi để đưa ra thông báo cụ thể hơn
    if (error.message.includes("Received tool input did not match expected schema")) {
        userFacingErrorMessage = "Xin lỗi, tôi gặp khó khăn trong việc hiểu chính xác yêu cầu của bạn để sử dụng công cụ tìm kiếm tin tức. Vui lòng thử diễn đạt lại câu hỏi một cách rõ ràng hơn về chủ đề hoặc địa điểm bạn muốn tìm tin tức nhé!";
    } else if (error.message.includes("GNEWS_API_KEY is not set")) {
        userFacingErrorMessage = "Rất tiếc, tôi không thể truy cập dịch vụ tin tức do thiếu cấu hình. Vui lòng thông báo cho quản trị viên nhé.";
    }
        return userFacingErrorMessage; // Trả về thông báo lỗi thân thiện

    } finally {
      if (AppDataSource.isInitialized) {
        try {
            await AppDataSource.destroy();
            console.log('Data Source has been closed.');
        } catch (destroyError) {
            console.error('Error closing Data Source:', destroyError);
        }
      }
    }
  return agentResponseOutput;
}

// 7. Các kịch bản tương tác mẫu để kiểm tra LLM gọi công cụ
// Bạn có thể tùy chỉnh hoặc thêm các câu hỏi khác ở đây để kiểm tra
// async function runLLMInteractions() {
//     console.log("\n--- Bắt đầu các kịch bản tương tác với LLM ---");

//     await chatWithGemini("Thời tiết Hồ Chí Minh hôm nay thế nào?");
//     await chatWithGemini("Tìm tin tức về Hà Nội, lấy 2 bài mới nhất.");
//     await chatWithGemini("Đường đi từ Hà Nội đến TP. Hồ Chí Minh mất bao lâu?");
//     await chatWithGemini("Tọa độ của Paris là gì?");
//     await chatWithGemini("Tin tức về Đà Nẵng và thời tiết ở Huế.");
//     await chatWithGemini("Tìm các tỉnh gần Hà Nội");

//     console.log("\n--- Kết thúc các kịch bản tương tác với LLM ---");
// }

// // Chạy hàm tương tác chính của ứng dụng
// runLLMInteractions().catch(err => {
//     console.error("Lỗi không mong muốn trong quá trình chạy ứng dụng:", err);
//     process.exit(1);
// });