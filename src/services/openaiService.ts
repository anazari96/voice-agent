import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const getAIResponse = async (
  conversationHistory: { role: 'system' | 'user' | 'assistant'; content: string }[],
  userMessage: string,
  detectedLanguage: string | null = null,
  abortSignal?: AbortSignal
) => {
  try {
    // Create messages array with language instruction if language is detected
    const messages = [...conversationHistory];
    
    // If a language is detected and it's not English, add instruction to respond in that language
    if (detectedLanguage && detectedLanguage !== 'en' && detectedLanguage !== 'en-US') {
      // Map common language codes to language names for better instructions
      const languageNames: { [key: string]: string } = {
        'es': 'Spanish',
        'fr': 'French',
        'de': 'German',
        'it': 'Italian',
        'pt': 'Portuguese',
        'zh': 'Chinese',
        'ja': 'Japanese',
        'ko': 'Korean',
        'ru': 'Russian',
        'ar': 'Arabic',
        'hi': 'Hindi',
        'nl': 'Dutch',
        'pl': 'Polish',
        'tr': 'Turkish',
        'sv': 'Swedish',
        'da': 'Danish',
        'fi': 'Finnish',
        'no': 'Norwegian',
        'cs': 'Czech',
        'ro': 'Romanian',
        'el': 'Greek',
        'hu': 'Hungarian',
        'vi': 'Vietnamese',
        'th': 'Thai',
        'id': 'Indonesian',
        'ms': 'Malay',
        'uk': 'Ukrainian',
        'he': 'Hebrew',
        'sk': 'Slovak',
        'hr': 'Croatian',
        'bg': 'Bulgarian',
        'ta': 'Tamil',
        'fil': 'Filipino'
      };
      
      const languageName = languageNames[detectedLanguage] || detectedLanguage;
      const languageInstruction = `IMPORTANT: The user is speaking in ${languageName}. Please respond ONLY in ${languageName}. Do not switch to English or any other language.`;
      
      // Add language instruction as a system message if not already present, or append to existing system message
      const systemMessageIndex = messages.findIndex(msg => msg.role === 'system');
      if (systemMessageIndex >= 0) {
        messages[systemMessageIndex] = {
          ...messages[systemMessageIndex],
          content: `${messages[systemMessageIndex].content}\n\n${languageInstruction}`
        };
      } else {
        messages.unshift({ role: 'system', content: languageInstruction });
      }
    }
    
    // Add the user message
    messages.push({ role: 'user', content: userMessage } as const);

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o', // or gpt-3.5-turbo
      messages: messages,
      stream: false, // For simplicity in this demo, we'll wait for full text. For true realtime, use stream: true
    }, {
      signal: abortSignal // Support cancellation
    });

    return completion.choices[0]?.message?.content || "I'm sorry, I didn't catch that.";
  } catch (error: any) {
    // Check if request was aborted
    if (error?.name === 'AbortError' || abortSignal?.aborted) {
      console.log('[OpenAI] Request was aborted');
      throw error; // Re-throw to be handled by caller
    }
    console.error('Error getting OpenAI response:', error);
    return "I'm having trouble connecting to my brain right now.";
  }
};

