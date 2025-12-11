"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAIResponse = void 0;
const openai_1 = __importDefault(require("openai"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const openai = new openai_1.default({
    apiKey: process.env.OPENAI_API_KEY,
});
const getAIResponse = async (conversationHistory, userMessage) => {
    try {
        const messages = [
            ...conversationHistory,
            { role: 'user', content: userMessage }
        ];
        const completion = await openai.chat.completions.create({
            model: 'gpt-4o', // or gpt-3.5-turbo
            messages: messages,
            stream: false, // For simplicity in this demo, we'll wait for full text. For true realtime, use stream: true
        });
        return completion.choices[0]?.message?.content || "I'm sorry, I didn't catch that.";
    }
    catch (error) {
        console.error('Error getting OpenAI response:', error);
        return "I'm having trouble connecting to my brain right now.";
    }
};
exports.getAIResponse = getAIResponse;
