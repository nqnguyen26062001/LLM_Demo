import { HNSWLib } from "@langchain/community/vectorstores/hnswlib";
import { Document } from "@langchain/core/documents";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { HarmBlockThreshold, HarmCategory } from "@google/generative-ai";
import { HumanMessage, AIMessage, BaseMessage } from "@langchain/core/messages";

let vectorStore: HNSWLib | null = null;
let embeddings: GoogleGenerativeAIEmbeddings | null = null;
const VECTOR_STORE_PATH = "./hnswlib_data"; // Thư mục để lưu trữ dữ liệu

export async function getVectorStore() {
    embeddings ??= new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GEMINI_API_KEY,
        model: "embedding-001",
    });

    if (!vectorStore) {
        try {
            vectorStore = await HNSWLib.load(VECTOR_STORE_PATH, embeddings);
            console.log("Vector Store loaded from disk.");
        } catch (e) {
            console.warn("Vector Store not found on disk or failed to load. Attempting to create new HNSWLib instance. Error:", e);
            
            // Create properly typed dummy document
            const dummyDocs = [
                new Document({
                    pageContent: "This is a base document to initialize the HNSWLib vector store and set its embedding dimension.",
                    metadata: { source: "initial_setup" }
                })
            ];
            
            try {
                vectorStore = await HNSWLib.fromDocuments(dummyDocs, embeddings);
                console.log("New HNSWLib Vector Store created from dummy documents.");
                await vectorStore.save(VECTOR_STORE_PATH);
                console.log("New HNSWLib Vector Store saved to disk for persistence.");
            } catch (createError) {
                console.error("CRITICAL ERROR: Failed to create HNSWLib from documents. Check API key and network connection:", createError);
                throw createError;
            }
        }
    }
    return vectorStore;
}



// Khi bạn cần lưu lại trạng thái (ví dụ: trước khi thoát ứng dụng hoặc định kỳ)
export async function saveVectorStore() {
    if (vectorStore) {
        await vectorStore.save(VECTOR_STORE_PATH);
        console.log("Vector Store saved to disk.");
    }
}

// Hàm để thêm tin nhắn vào vector store (long-term memory)
export async function addMessagesToVectorStore(messages: BaseMessage[]) {
    const store = await getVectorStore(); // Đảm bảo store đã được khởi tạo
    const docs = messages.map(msg => new Document({
        pageContent: msg.content.toString(),
        metadata: {
            type: msg.getType(),
            timestamp: new Date().toISOString(),
        },
    }));
    await store.addDocuments(docs);
    console.log(`Added ${docs.length} messages to vector store.`);
}

export async function testEmbeddingModel() {
    const testEmbeddingsModel = new GoogleGenerativeAIEmbeddings({
        apiKey: process.env.GEMINI_API_KEY,
        model: "embedding-001",
    });

    try {
        console.log("Testing embedding model with a sample text...");
        const sampleText = "Hello world";
        const embedding = await testEmbeddingsModel.embedQuery(sampleText);
        console.log("Embedding generated successfully.");
        console.log("Embedding length:", embedding.length);
        // console.log("Sample Embedding:", embedding.slice(0, 5), "..."); // In ra vài phần tử đầu

        if (embedding.length === 0) {
            console.error("ERROR: Embedding length is 0. Model might not be working correctly or API key is invalid.");
        } else {
            console.log("Embedding model is working correctly with length:", embedding.length);
        }
    } catch (error) {
        console.error("ERROR: Failed to generate embedding:", error);
    }
}
