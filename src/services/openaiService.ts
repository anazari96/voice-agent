import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const getAIResponse = async (
  conversationHistory: { role: 'system' | 'user' | 'assistant'; content: string }[],
  userMessage: string
) => {
  try {
    const messages = [
      ...conversationHistory,
      { role: 'user', content: userMessage } as const
    ];

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', // or gpt-3.5-turbo
      messages: messages,
      stream: false, // For simplicity in this demo, we'll wait for full text. For true realtime, use stream: true
    });

    return completion.choices[0]?.message?.content || "I'm sorry, I didn't catch that.";
  } catch (error) {
    console.error('Error getting OpenAI response:', error);
    return "I'm having trouble connecting to my brain right now.";
  }
};

