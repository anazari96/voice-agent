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

  // Function to send greetings when both stream and Deepgram are ready
  const sendGreetingsIfReady = () => {
    if (greetings && !greetingSent && streamSid && deepgramLive.getReadyState() === 1) {
      greetingSent = true;
      console.log('Sending greetings:', greetings);
      textToSpeechStream(greetings).then((audioStream) => {
        sendAudioToStream(audioStream);
      }).catch((err) => {
        console.error('Error sending greetings:', err);
      });
    }
  };

  deepgramLive.on(LiveTranscriptionEvents.Open, () => {
    console.log('Deepgram Connected');
    // Try to send greetings when Deepgram opens (if stream is already started)
    sendGreetingsIfReady();
  });

  // Function to send audio to Twilio stream
  const sendAudioToStream = (audioStream: NodeJS.ReadableStream | null) => {
    if (audioStream && streamSid) {
      audioStream.on('data', (chunk: Buffer) => {
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
        }
      });
    }
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
      const data = JSON.parse(message);
      
      switch (data.event) {
        case 'connected':
          console.log('Twilio Media Stream Connected');
          break;
        case 'start':
          console.log('Media Stream Started:', data.streamSid);
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
        case 'stop':
          console.log('Media Stream Stopped');
          deepgramLive.finish();
          break;
      }
    } catch (e) {
      console.error('Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('Twilio Stream Connection Closed');
    deepgramLive.finish();
  });
};

