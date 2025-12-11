import { WebSocket } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { supabase } from './supabaseClient';
import { getProducts } from './cloverService';
import { getAIResponse } from './openaiService';
import { textToSpeechStream } from './elevenLabsService';
import dotenv from 'dotenv';

dotenv.config();

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || '');

export const handleStream = async (ws: WebSocket) => {
  console.log('New Stream Connection');

  // State
  let streamSid: string | null = null;
  let businessContext: string = '';
  let conversationHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  let greetings: string = '';
  let greetingSent: boolean = false;

  // Fetch Context
  try {
    const { data: businessInfo } = await supabase.from('business_info').select('*').limit(1).single();
    const products = await getProducts();
    
    const businessName = businessInfo?.business_name || 'Our Business';
    const description = businessInfo?.description || '';
    const productList = products.map((p: any) => `${p.name} ($${(p.price / 100).toFixed(2)})`).join(', ');
    greetings = businessInfo?.greetings || '';

    businessContext = `You are a helpful AI assistant for ${businessName}. 
    Business Description: ${description}.
    Available Products: ${productList}.
    Keep responses concise and conversational.`;
    
    conversationHistory.push({ role: 'system', content: businessContext });
    console.log('Context loaded for stream.');
  } catch (err) {
    console.error('Error loading context:', err);
    conversationHistory.push({ role: 'system', content: 'You are a helpful assistant.' });
  }

  // Deepgram Live Client
  const deepgramLive = deepgram.listen.live({
    model: 'nova-2',
    language: 'en-US',
    smart_format: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    endpointing: 300 // Wait 300ms of silence to trigger final
  });

  // Function to send greetings when stream is ready
  const sendGreetingsIfReady = () => {
    console.log('[Greetings] Check - greetings:', !!greetings, 'greetingSent:', greetingSent, 'streamSid:', !!streamSid, 'deepgramState:', deepgramLive.getReadyState());
    
    // Only need streamSid to send greetings - don't wait for Deepgram
    if (greetings && !greetingSent && streamSid) {
      greetingSent = true;
      
      // Small delay to ensure Twilio is ready to receive audio
      setTimeout(async () => {
        console.log('[Greetings] Sending greetings:', greetings);
        try {
          const audioStream = await textToSpeechStream(greetings);
          if (audioStream) {
            console.log('[Greetings] Audio stream received, sending to Twilio');
            sendAudioToStream(audioStream);
          } else {
            console.error('[Greetings] Failed to get audio stream from ElevenLabs');
          }
        } catch (err) {
          console.error('[Greetings] Error sending greetings:', err);
        }
      }, 500); // 500ms delay to let Twilio stream fully initialize
    }
  };

  deepgramLive.on(LiveTranscriptionEvents.Open, () => {
    console.log('Deepgram Connected');
    // Try to send greetings when Deepgram opens (if stream is already started)
    sendGreetingsIfReady();
  });

  // Function to send audio to Twilio stream
  const sendAudioToStream = (audioStream: NodeJS.ReadableStream | null) => {
    if (!audioStream) {
      console.error('[Audio] No audio stream to send');
      return;
    }
    
    if (!streamSid) {
      console.error('[Audio] No streamSid available - cannot send audio');
      return;
    }

    console.log('[Audio] Starting to send audio to Twilio, streamSid:', streamSid);
    let chunkCount = 0;
    let totalBytes = 0;

    audioStream.on('data', (chunk: Buffer) => {
      chunkCount++;
      totalBytes += chunk.length;
      
      const payload = chunk.toString('base64');
      const message = {
        event: 'media',
        streamSid: streamSid,
        media: {
          payload: payload
        }
      };
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
      } else {
        console.error('[Audio] WebSocket not open, state:', ws.readyState);
      }
    });

    audioStream.on('end', () => {
      console.log(`[Audio] Stream complete - sent ${chunkCount} chunks, ${totalBytes} bytes total`);
      
      // Send a mark event to track when audio playback completes
      if (ws.readyState === WebSocket.OPEN && streamSid) {
        const markMessage = {
          event: 'mark',
          streamSid: streamSid,
          mark: {
            name: `audio_complete_${Date.now()}`
          }
        };
        ws.send(JSON.stringify(markMessage));
        console.log('[Audio] Mark event sent');
      }
    });

    audioStream.on('error', (err) => {
      console.error('[Audio] Stream error:', err);
    });
  };

  deepgramLive.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript && data.is_final) {
      console.log('User said:', transcript);
      
      // Add to history
      conversationHistory.push({ role: 'user', content: transcript });

      // Get AI Response
      const aiResponse = await getAIResponse(conversationHistory, transcript);
      console.log('AI response:', aiResponse);
      conversationHistory.push({ role: 'assistant', content: aiResponse });

      // TTS and Stream back
      const audioStream = await textToSpeechStream(aiResponse);
      sendAudioToStream(audioStream);
    }
  });

  deepgramLive.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('Deepgram error:', err);
  });

  // Handle WS messages from Twilio
  ws.on('message', (message: string) => {
    try {
      const msg = message.toString(); // Ensure it's a string
      const data = JSON.parse(msg);
      
      // Log all events for debugging
      if (data.event !== 'media') {
        console.log('[Twilio] Received event:', data.event, JSON.stringify(data, null, 2));
      }
      
      switch (data.event) {
        case 'connected':
          console.log('[Twilio] Media Stream Connected');
          break;
        case 'start':
          console.log('[Twilio] Media Stream Started:', data.streamSid);
          console.log('[Twilio] Start payload:', JSON.stringify(data.start, null, 2));
          streamSid = data.streamSid;
          // Try to send greetings when stream starts (if Deepgram is already open)
          sendGreetingsIfReady();
          break;
        case 'media':
          // Send audio to Deepgram
          if (deepgramLive.getReadyState() === 1) { // 1 = OPEN
             const payload = Buffer.from(data.media.payload, 'base64');
             deepgramLive.send(payload as any);
          }
          break;
        case 'mark':
          console.log('[Twilio] Mark received:', data.mark?.name);
          break;
        case 'stop':
          console.log('Media Stream Stopped');
          deepgramLive.requestClose();
          break;
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Twilio Stream Connection Closed');
    deepgramLive.requestClose();
  });
};

