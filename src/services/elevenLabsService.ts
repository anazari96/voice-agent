import axios from 'axios';
import dotenv from 'dotenv';
import { Readable } from 'stream';

dotenv.config();

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM'; // Default voice (Rachel)

/**
 * Read error response stream and convert to string
 */
const readErrorStream = async (stream: NodeJS.ReadableStream): Promise<string> => {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => chunks.push(chunk));
    stream.on('end', () => {
      try {
        const buffer = Buffer.concat(chunks);
        resolve(buffer.toString('utf-8'));
      } catch (e) {
        reject(e);
      }
    });
    stream.on('error', reject);
  });
};

/**
 * Validate ElevenLabs API key by making a test request
 */
export const validateElevenLabsApiKey = async (): Promise<boolean> => {
  if (!ELEVENLABS_API_KEY) {
    console.error('[ElevenLabs] API Key is missing');
    return false;
  }

  try {
    // Use a simple API endpoint to validate the key
    const response = await axios.get('https://api.elevenlabs.io/v1/user', {
      headers: {
        'xi-api-key': ELEVENLABS_API_KEY
      }
    });
    console.log('[ElevenLabs] API Key validated successfully');
    return true;
  } catch (error: any) {
    const status = error.response?.status;
    if (status === 401) {
      console.error('[ElevenLabs] API Key validation failed: Invalid or expired API key');
      
      // Try to read error message
      if (error.response?.data) {
        try {
          if (error.response.data instanceof Readable || (typeof error.response.data === 'object' && error.response.data.pipe)) {
            const errorMessage = await readErrorStream(error.response.data);
            console.error('[ElevenLabs] Error details:', errorMessage);
          } else {
            console.error('[ElevenLabs] Error details:', JSON.stringify(error.response.data, null, 2));
          }
        } catch (e) {
          console.error('[ElevenLabs] Could not read error response');
        }
      }
    } else {
      console.error('[ElevenLabs] API Key validation error:', status, error.message);
    }
    return false;
  }
};

export const textToSpeechStream = async (text: string): Promise<NodeJS.ReadableStream | null> => {
  if (!ELEVENLABS_API_KEY) {
    console.error('[ElevenLabs] API Key is missing. Please set ELEVENLABS_API_KEY in your .env file.');
    return null;
  }

  // Validate API key format (ElevenLabs API keys are typically long alphanumeric strings)
  if (ELEVENLABS_API_KEY.length < 20) {
    console.warn('[ElevenLabs] API Key appears to be invalid (too short). Please verify your ELEVENLABS_API_KEY.');
  }

  console.log('[ElevenLabs] Generating TTS for:', text.substring(0, 50) + '...');

  try {
    // First, make a simple request to validate the API key (without stream to avoid decompression issues)
    // This helps catch 401 errors before attempting the stream request
    try {
      await axios.get('https://api.elevenlabs.io/v1/user', {
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY
        },
        timeout: 5000 // 5 second timeout
      });
    } catch (authError: any) {
      if (authError.response?.status === 401) {
        console.error('[ElevenLabs] API Key authentication failed (401).');
        console.error('[ElevenLabs] Please verify your ELEVENLABS_API_KEY is correct and has not expired.');
        if (authError.response?.data) {
          try {
            console.error('[ElevenLabs] Error details:', JSON.stringify(authError.response.data, null, 2));
          } catch (e) {
            // Ignore parsing errors
          }
        }
        return null;
      }
      // If it's not a 401, continue with the TTS request (might be a network issue)
      console.warn('[ElevenLabs] API key validation check failed, but continuing with TTS request:', authError.message);
    }

    // Now make the actual TTS stream request
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
      responseType: 'stream',
      timeout: 30000 // 30 second timeout for TTS generation
    });

    console.log('[ElevenLabs] TTS stream started successfully');
    console.log('[ElevenLabs] Response status:', response.status);
    console.log('[ElevenLabs] Response content-type:', response.headers['content-type']);
    return response.data;
  } catch (error: any) {
    // Handle axios errors
    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      if (status === 401) {
        console.error('[ElevenLabs] Authentication failed (401). Please check:');
        console.error('  1. Your ELEVENLABS_API_KEY is correct in your .env file');
        console.error('  2. Your API key has not expired');
        console.error('  3. Your API key has the necessary permissions');
        console.error('  4. The API key format is correct');
        console.error(`  5. Current API key (first 8 chars): ${ELEVENLABS_API_KEY?.substring(0, 8)}...`);
        
        // Try to extract error message from response (handle compressed/stream responses)
        if (error.response.data) {
          try {
            // If response is a stream (which happens with responseType: 'stream'), read it
            if (error.response.data instanceof Readable || (typeof error.response.data === 'object' && error.response.data.pipe)) {
              try {
                const errorMessage = await readErrorStream(error.response.data);
                console.error('[ElevenLabs] Error response:', errorMessage);
              } catch (streamError) {
                console.error('[ElevenLabs] Could not read error stream. The response may be compressed.');
                const errorMessage = streamError instanceof Error ? streamError.message : String(streamError);
                console.error('[ElevenLabs] Stream error:', errorMessage);
              }
            } else if (typeof error.response.data === 'string') {
              console.error('[ElevenLabs] Error response:', error.response.data);
            } else {
              console.error('[ElevenLabs] Error details:', JSON.stringify(error.response.data, null, 2));
            }
          } catch (e: any) {
            console.error('[ElevenLabs] Could not parse error response:', e.message || e);
          }
        }
      } else {
        console.error('[ElevenLabs] Error generating speech:', status, statusText || error.message);
        if (error.response.data) {
          try {
            // Handle stream error responses
            if (error.response.data instanceof Readable || (typeof error.response.data === 'object' && error.response.data.pipe)) {
              try {
                const errorMessage = await readErrorStream(error.response.data);
                console.error('[ElevenLabs] Error response:', errorMessage);
              } catch (streamError) {
                // Ignore stream reading errors for non-401 errors
                console.error('[ElevenLabs] Could not read error stream');
              }
            } else {
              console.error('[ElevenLabs] Error details:', error.response.data);
            }
          } catch (e) {
            // Ignore parsing errors
          }
        }
      }
    } else if (error.request) {
      // Request was made but no response received
      console.error('[ElevenLabs] No response received from ElevenLabs API');
      console.error('[ElevenLabs] Error:', error.message);
    } else {
      // Error setting up the request
      console.error('[ElevenLabs] Error setting up request:', error.message);
    }
    
    return null;
  }
};

