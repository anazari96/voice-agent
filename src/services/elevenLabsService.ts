import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default voice (Rachel)

export const textToSpeechStream = async (text: string): Promise<NodeJS.ReadableStream | null> => {
  if (!ELEVENLABS_API_KEY) {
    console.warn('ElevenLabs API Key missing');
    return null;
  }

  try {
    const response = await axios({
      method: 'POST',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream?output_format=ulaw_8000`,
      data: {
        text,
        model_id: 'eleven_turbo_v2', // Faster for realtime
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      headers: {
        'Accept': 'audio/mpeg',
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      responseType: 'stream'
    });

    return response.data;
  } catch (error) {
    console.error('Error generating speech with ElevenLabs:', error);
    return null;
  }
};

