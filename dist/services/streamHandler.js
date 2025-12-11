"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleStream = void 0;
const ws_1 = require("ws");
const sdk_1 = require("@deepgram/sdk");
const supabaseClient_1 = require("./supabaseClient");
const cloverService_1 = require("./cloverService");
const openaiService_1 = require("./openaiService");
const elevenLabsService_1 = require("./elevenLabsService");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const deepgram = (0, sdk_1.createClient)(process.env.DEEPGRAM_API_KEY || '');
const handleStream = (ws) => {
    console.log('[Stream] New Stream Connection');
    console.log('[Stream] WebSocket readyState:', ws.readyState);
    // State - must be initialized BEFORE any async operations
    let streamSid = null;
    let businessContext = '';
    let conversationHistory = [];
    let greetings = '';
    let greetingSent = false;
    let contextLoaded = false;
    // Deepgram Live Client - initialize immediately
    const deepgramLive = deepgram.listen.live({
        model: 'nova-2',
        language: 'en-US',
        smart_format: true,
        encoding: 'mulaw',
        sample_rate: 8000,
        channels: 1,
        endpointing: 300 // Wait 300ms of silence to trigger final
    });
    // Function to send audio to Twilio stream
    const sendAudioToStream = (audioStream) => {
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
        audioStream.on('data', (chunk) => {
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
            if (ws.readyState === ws_1.WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
            else {
                console.error('[Audio] WebSocket not open, state:', ws.readyState);
            }
        });
        audioStream.on('end', () => {
            console.log(`[Audio] Stream complete - sent ${chunkCount} chunks, ${totalBytes} bytes total`);
            // Send a mark event to track when audio playback completes
            if (ws.readyState === ws_1.WebSocket.OPEN && streamSid) {
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
                    const audioStream = await (0, elevenLabsService_1.textToSpeechStream)(greetings);
                    if (audioStream) {
                        console.log('[Greetings] Audio stream received, sending to Twilio');
                        sendAudioToStream(audioStream);
                    }
                    else {
                        console.error('[Greetings] Failed to get audio stream from ElevenLabs');
                    }
                }
                catch (err) {
                    console.error('[Greetings] Error sending greetings:', err);
                }
            }, 500); // 500ms delay to let Twilio stream fully initialize
        }
    };
    // IMMEDIATELY attach WebSocket message handler (before any async operations!)
    ws.on('message', (message) => {
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
                        deepgramLive.send(payload);
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
        }
        catch (e) {
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
    deepgramLive.on(sdk_1.LiveTranscriptionEvents.Open, () => {
        console.log('[Deepgram] Connected');
        // Try to send greetings when Deepgram opens
        sendGreetingsIfReady();
    });
    deepgramLive.on(sdk_1.LiveTranscriptionEvents.Transcript, async (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        if (transcript && data.is_final) {
            console.log('[User] Said:', transcript);
            // Add to history
            conversationHistory.push({ role: 'user', content: transcript });
            // Get AI Response
            const aiResponse = await (0, openaiService_1.getAIResponse)(conversationHistory, transcript);
            console.log('[AI] Response:', aiResponse);
            conversationHistory.push({ role: 'assistant', content: aiResponse });
            // TTS and Stream back
            const audioStream = await (0, elevenLabsService_1.textToSpeechStream)(aiResponse);
            sendAudioToStream(audioStream);
        }
    });
    deepgramLive.on(sdk_1.LiveTranscriptionEvents.Error, (err) => {
        console.error('[Deepgram] Error:', err);
    });
    // NOW fetch context asynchronously (after handlers are attached)
    (async () => {
        try {
            console.log('[Context] Loading business context...');
            const { data: businessInfo } = await supabaseClient_1.supabase.from('business_info').select('*').limit(1).single();
            const products = await (0, cloverService_1.getProducts)();
            const businessName = businessInfo?.business_name || 'Our Business';
            const description = businessInfo?.description || '';
            const productList = products.map((p) => `${p.name} ($${(p.price / 100).toFixed(2)})`).join(', ');
            greetings = businessInfo?.greetings || '';
            businessContext = `You are a helpful AI assistant for ${businessName}. 
      Business Description: ${description}.
      Available Products: ${productList}.
      Keep responses concise and conversational.`;
            conversationHistory.push({ role: 'system', content: businessContext });
            contextLoaded = true;
            console.log('[Context] Loaded successfully. Greetings:', greetings || '(none)');
            // Try to send greetings now that context is loaded
            sendGreetingsIfReady();
        }
        catch (err) {
            console.error('[Context] Error loading:', err);
            conversationHistory.push({ role: 'system', content: 'You are a helpful assistant.' });
            contextLoaded = true;
            // Still try to send greetings even with default context
            sendGreetingsIfReady();
        }
    })();
};
exports.handleStream = handleStream;
