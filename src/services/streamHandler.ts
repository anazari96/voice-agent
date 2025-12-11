import { WebSocket } from 'ws';
import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';
import { supabase } from './supabaseClient';
import { getProducts } from './cloverService';
import { getAIResponse } from './openaiService';
import { textToSpeechStream } from './elevenLabsService';
import { franc } from 'franc';
import dotenv from 'dotenv';

dotenv.config();

const deepgram = createClient(process.env.DEEPGRAM_API_KEY || '');

export const handleStream = (ws: WebSocket) => {
  console.log('[Stream] New Stream Connection');
  console.log('[Stream] WebSocket readyState:', ws.readyState);

  // State - must be initialized BEFORE any async operations
  let streamSid: string | null = null;
  let businessContext: string = '';
  let conversationHistory: { role: 'system' | 'user' | 'assistant'; content: string }[] = [];
  let greetings: string = '';
  let greetingSent: boolean = false;
  let contextLoaded: boolean = false;
  let detectedLanguage: string | null = null; // Store detected language (BCP-47 code, e.g., 'en', 'es', 'fr')
  let isAgentSpeaking: boolean = false; // Track if agent is currently speaking
  let currentAudioStream: NodeJS.ReadableStream | null = null; // Reference to current audio stream for interruption
  let shouldCancelResponse: boolean = false; // Flag to cancel ongoing response generation
  let currentAbortController: AbortController | null = null; // AbortController for canceling requests

  // Function to convert ISO 639-3 language code (from franc) to ISO 639-1 (for APIs)
  const convertToISO6391 = (code6393: string): string | null => {
    // Map of common ISO 639-3 to ISO 639-1 codes
    const langMap: { [key: string]: string } = {
      'eng': 'en', 'spa': 'es', 'fra': 'fr', 'deu': 'de', 'ita': 'it',
      'por': 'pt', 'zho': 'zh', 'jpn': 'ja', 'kor': 'ko', 'rus': 'ru',
      'ara': 'ar', 'hin': 'hi', 'nld': 'nl', 'pol': 'pl', 'tur': 'tr',
      'swe': 'sv', 'dan': 'da', 'fin': 'fi', 'nor': 'no', 'ces': 'cs',
      'ron': 'ro', 'ell': 'el', 'hun': 'hu', 'vie': 'vi', 'tha': 'th',
      'ind': 'id', 'msa': 'ms', 'ukr': 'uk', 'heb': 'he', 'slk': 'sk',
      'hrv': 'hr', 'bul': 'bg', 'tam': 'ta', 'fil': 'fil'
    };
    return langMap[code6393] || null;
  };

  // Function to detect language from text
  const detectLanguageFromText = (text: string): string | null => {
    try {
      // franc returns ISO 639-3 codes (e.g., 'eng', 'spa', 'fra')
      const detectedCode6393 = franc(text);
      
      if (!detectedCode6393 || detectedCode6393 === 'und') {
        // 'und' means undetermined
        return null;
      }
      
      // Convert to ISO 639-1 for API compatibility
      const code6391 = convertToISO6391(detectedCode6393);
      console.log('[Language] Detected from text:', detectedCode6393, '->', code6391);
      return code6391;
    } catch (err) {
      console.error('[Language] Error detecting language:', err);
      return null;
    }
  };

  // Deepgram Live Client - initialize immediately
  // Note: detect_language is not supported for live streaming, so we use text-based detection
  const deepgramLive = deepgram.listen.live({
    model: 'nova-2', // Nova-2 is multilingual and supports many languages
    smart_format: true,
    encoding: 'mulaw',
    sample_rate: 8000,
    channels: 1,
    endpointing: 300 // Wait 300ms of silence to trigger final
  });

  // Function to stop current audio stream and cancel ongoing operations (for interruption)
  const stopCurrentAudio = () => {
    // Set cancellation flag
    shouldCancelResponse = true;
    
    // Cancel any ongoing HTTP requests
    if (currentAbortController) {
      console.log('[Interruption] Aborting ongoing requests');
      currentAbortController.abort();
      currentAbortController = null;
    }
    
    // Stop current audio stream
    if (currentAudioStream && isAgentSpeaking) {
      console.log('[Interruption] Stopping current audio stream');
      try {
        // Destroy the stream to stop it immediately
        if (typeof (currentAudioStream as any).destroy === 'function') {
          (currentAudioStream as any).destroy();
        } else if (typeof (currentAudioStream as any).abort === 'function') {
          (currentAudioStream as any).abort();
        }
        currentAudioStream = null;
        isAgentSpeaking = false;
        console.log('[Interruption] Audio stream stopped successfully');
      } catch (err) {
        console.error('[Interruption] Error stopping audio stream:', err);
        currentAudioStream = null;
        isAgentSpeaking = false;
      }
    }
  };

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

    // Stop any currently playing audio (interruption handling)
    if (isAgentSpeaking && currentAudioStream) {
      console.log('[Audio] Stopping previous audio stream before starting new one');
      stopCurrentAudio();
    }

    // Set speaking state and store stream reference
    isAgentSpeaking = true;
    currentAudioStream = audioStream;

    console.log('[Audio] Starting to send audio to Twilio, streamSid:', streamSid);
    let chunkCount = 0;
    let totalBytes = 0;

    audioStream.on('data', (chunk: Buffer) => {
      // Check if stream was interrupted (destroyed)
      if (!isAgentSpeaking || !currentAudioStream) {
        console.log('[Audio] Stream interrupted, stopping data transmission');
        return;
      }

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
      
      // Only send mark event if this is still the current stream
      if (currentAudioStream === audioStream && isAgentSpeaking) {
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
      }
      
      // Reset speaking state if this was the current stream
      if (currentAudioStream === audioStream) {
        isAgentSpeaking = false;
        currentAudioStream = null;
      }
    });

    audioStream.on('error', (err) => {
      console.error('[Audio] Stream error:', err);
      // Reset speaking state on error
      if (currentAudioStream === audioStream) {
        isAgentSpeaking = false;
        currentAudioStream = null;
      }
    });

    // Handle stream close/destroy events
    audioStream.on('close', () => {
      console.log('[Audio] Stream closed');
      if (currentAudioStream === audioStream) {
        isAgentSpeaking = false;
        currentAudioStream = null;
      }
    });
  };

  // Function to send greetings when stream is ready
  const sendGreetingsIfReady = () => {
    console.log('[Greetings] Check - greetings:', !!greetings, 'greetingSent:', greetingSent, 'streamSid:', !!streamSid, 'contextLoaded:', contextLoaded);
    
    // Need streamSid AND context to be loaded
    if (greetings && !greetingSent && streamSid && contextLoaded) {
      greetingSent = true;
      
      // Small delay to ensure Twilio is ready to receive audio
      setTimeout(async () => {
        console.log('[Greetings] Sending greetings:', greetings);
        try {
          conversationHistory.push({role: "assistant", content: greetings});
          // For greetings, use default language (null) or detected language if available
          const audioStream = await textToSpeechStream(greetings, detectedLanguage);
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

  // IMMEDIATELY attach WebSocket message handler (before any async operations!)
  ws.on('message', (message: Buffer | string) => {
    try {
      const msg = message.toString();
      
      // Log raw message for debugging (first 500 chars for non-media)
      if (!msg.includes('"event":"media"')) {
        console.log('[Twilio RAW] Message received:', msg.substring(0, 500));
      }
      
      const data = JSON.parse(msg);
      
      // Log all events for debugging
      if (data.event !== 'media') {
        console.log('[Twilio] Parsed event:', data.event);
      }
      
      switch (data.event) {
        case 'connected':
          console.log('[Twilio] Media Stream Connected');
          break;
        case 'start':
          console.log('[Twilio] Media Stream Started:', data.streamSid);
          console.log('[Twilio] Start payload:', JSON.stringify(data.start, null, 2));
          streamSid = data.streamSid;
          // Try to send greetings when stream starts
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
          console.log('[Twilio] Media Stream Stopped');
          deepgramLive.requestClose();
          break;
      }
    } catch (e) {
      console.error('[Twilio] Error parsing message:', e);
    }
  });

  ws.on('close', () => {
    console.log('[Twilio] Stream Connection Closed');
    deepgramLive.requestClose();
  });

  ws.on('error', (err) => {
    console.error('[Twilio] WebSocket error:', err);
  });

  // Deepgram event handlers
  deepgramLive.on(LiveTranscriptionEvents.Open, () => {
    console.log('[Deepgram] Connected');
    // Try to send greetings when Deepgram opens
    sendGreetingsIfReady();
  });

  deepgramLive.on(LiveTranscriptionEvents.Transcript, async (data) => {
    const transcript = data.channel.alternatives[0].transcript;
    if (transcript && data.is_final) {
      console.log('[User] Said:', transcript);
      
      // Check if agent is currently speaking (interruption detection)
      if (isAgentSpeaking) {
        console.log('[Interruption] User interrupted agent while speaking');
        stopCurrentAudio();
      }
      
      // Create new AbortController for this response (but don't reset flag yet - it will be reset after we start processing)
      // This allows us to cancel if user interrupts again during generation
      const responseAbortController = new AbortController();
      currentAbortController = responseAbortController;
      
      // Reset cancellation flag for new response (after stopping previous)
      shouldCancelResponse = false;
      
      // Detect language from transcript text (since detect_language is not supported for live streaming)
      const detectedLang = detectLanguageFromText(transcript);
      if (detectedLang) {
        // Only update if we got a valid detection (don't overwrite with null)
        detectedLanguage = detectedLang;
        console.log('[Language] Detected language:', detectedLanguage);
      }
      
      // Check if cancelled before proceeding
      if (shouldCancelResponse) {
        console.log('[Interruption] Response cancelled before processing');
        return;
      }
      
      // Add to history
      conversationHistory.push({ role: 'user', content: transcript });

      // Get AI Response (pass detected language to respond in same language)
      // Check for cancellation before and after the call
      if (shouldCancelResponse) {
        console.log('[Interruption] Response cancelled before AI generation');
        return;
      }
      
      let aiResponse: string;
      try {
        aiResponse = await getAIResponse(conversationHistory, transcript, detectedLanguage, responseAbortController.signal);
      } catch (error: any) {
        // If aborted, just return
        if (error?.name === 'AbortError' || shouldCancelResponse) {
          console.log('[Interruption] AI response generation was aborted');
          return;
        }
        // For other errors, use fallback
        aiResponse = "I'm having trouble connecting to my brain right now.";
      }
      
      // Check if cancelled after AI response
      if (shouldCancelResponse) {
        console.log('[Interruption] Response cancelled after AI generation, not sending TTS');
        return;
      }
      
      console.log('[AI] Response:', aiResponse);
      conversationHistory.push({ role: 'assistant', content: aiResponse });

      // Check if cancelled before TTS
      if (shouldCancelResponse) {
        console.log('[Interruption] Response cancelled before TTS generation');
        return;
      }

      // TTS and Stream back (pass detected language for proper pronunciation)
      let audioStream: NodeJS.ReadableStream | null = null;
      try {
        audioStream = await textToSpeechStream(aiResponse, detectedLanguage, responseAbortController.signal);
      } catch (error: any) {
        // If aborted, just return
        if (error?.name === 'AbortError' || error?.code === 'ERR_CANCELED' || shouldCancelResponse) {
          console.log('[Interruption] TTS generation was aborted');
          return;
        }
        console.error('[TTS] Error generating audio:', error);
        return;
      }
      
      // Check if cancelled after TTS generation
      if (shouldCancelResponse || !audioStream) {
        console.log('[Interruption] Response cancelled after TTS generation, not sending audio');
        if (audioStream && typeof (audioStream as any).destroy === 'function') {
          (audioStream as any).destroy();
        }
        return;
      }
      
      sendAudioToStream(audioStream);
    }
  });

  deepgramLive.on(LiveTranscriptionEvents.Error, (err) => {
    console.error('[Deepgram] Error:', err);
  });

  // NOW fetch context asynchronously (after handlers are attached)
  (async () => {
    try {
      console.log('[Context] Loading business context...');
      const { data: businessInfo } = await supabase.from('business_info').select('*').limit(1).single();
      const products = await getProducts();
      
      const businessName = businessInfo?.business_name || 'Our Business';
      const description = businessInfo?.description || '';
      const productList = products.map((p: any) => `${p.name} ($${(p.price / 100).toFixed(2)})`).join(', ');
      greetings = businessInfo?.greetings || '';

      businessContext = `You are a helpful AI assistant for ${businessName}. 
      Business Description: ${description}.
      Available Products: ${productList}.
      Hours: ${businessInfo?.hours}
      Contact Info: ${businessInfo.contact_info}
      Keep responses concise and conversational.`;
      
      conversationHistory.push({ role: 'system', content: businessContext });
      contextLoaded = true;
      console.log('[Context] Loaded successfully. Greetings:', greetings || '(none)');
      
      // Try to send greetings now that context is loaded
      sendGreetingsIfReady();
    } catch (err) {
      console.error('[Context] Error loading:', err);
      conversationHistory.push({ role: 'system', content: 'You are a helpful assistant.' });
      contextLoaded = true;
      // Still try to send greetings even with default context
      sendGreetingsIfReady();
    }
  })();
};

