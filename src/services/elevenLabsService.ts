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

  console.log('[ElevenLabs] Generating TTS for:', text.substring(0, 50) + '...');

  try {
    const response = await axios({
      method: 'POST',
      url: `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream`,
      params: {
        output_format: 'ulaw_8000' // μ-law 8kHz for Twilio (query param)
      },
      data: {
        text,
        model_id: 'eleven_turbo_v2', // Faster for realtime
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      },
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY,
        'Content-Type': 'application/json'
      },
      responseType: 'stream'
    });

    console.log('[ElevenLabs] TTS stream started successfully');
    console.log('[ElevenLabs] Response status:', response.status);
    console.log('[ElevenLabs] Response content-type:', response.headers['content-type']);
    return response.data;
  } catch (error: any) {
    console.error('[ElevenLabs] Error generating speech:', error.response?.status, error.response?.data || error.message);
    return null;
  }
};

