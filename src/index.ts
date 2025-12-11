import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import twilio from 'twilio';
import dashboardRoutes from './routes/dashboardRoutes';
import { handleStream } from './services/streamHandler';

dotenv.config();

const app = express();
const server = createServer(app);
const twiml = new twilio.twiml.VoiceResponse();

// Use noServer mode to handle upgrades manually for Twilio WebSocket connections
// This prevents Express from intercepting the WebSocket upgrade request
const wss = new WebSocketServer({ noServer: true });

// Track active WebSocket connections
const activeConnections = new Set<WebSocket>();

/**
 * Determine WebSocket protocol (ws or wss) based on request headers
 */
const getWebSocketProtocol = (req: express.Request): 'ws' | 'wss' => {
  // Check for forwarded protocol (common with proxies like ngrok)
  const forwardedProto = req.headers['x-forwarded-proto'];
  // Check for direct HTTPS connection
  const isSecure = req.secure || forwardedProto === 'https';
  return isSecure ? 'wss' : 'ws';
};

/**
 * Build WebSocket URL for Twilio Stream
 */
const buildStreamUrl = (req: express.Request): string => {
  const protocol = getWebSocketProtocol(req);
  const host = req.headers.host || 'localhost:3000';
  return `${protocol}://${host}/streams`;
};

/**
 * Handle WebSocket upgrade requests from Twilio
 * This MUST be registered before the server starts listening
 * to intercept upgrade requests before Express middleware processes them
 */
server.on('upgrade', (request, socket, head) => {
  const url = request.url || '/';
  let pathname: string;

  try {
    const parsedUrl = new URL(url, `http://${request.headers.host || 'localhost'}`);
    pathname = parsedUrl.pathname;
  } catch (e) {
    // Fallback for malformed URLs
    pathname = url.split('?')[0];
  }

  console.log(`[WebSocket Upgrade] Received upgrade request`);
  console.log(`[WebSocket Upgrade] Path: ${pathname}`);
  console.log(`[WebSocket Upgrade] Method: ${request.method}`);
  console.log(`[WebSocket Upgrade] Headers:`, {
    upgrade: request.headers.upgrade,
    connection: request.headers.connection,
    origin: request.headers.origin,
    'sec-websocket-key': request.headers['sec-websocket-key'] ? 'present' : 'missing',
    'sec-websocket-version': request.headers['sec-websocket-version']
  });

  // Only allow connections to /streams endpoint
  if (pathname === '/streams') {
    console.log('[WebSocket Upgrade] Accepting upgrade for /streams');
    try {
      wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
        console.log('[WebSocket] Connection successfully upgraded');
        console.log('[WebSocket] Ready state:', ws.readyState);
        activeConnections.add(ws);
        
        // Handle connection cleanup
        ws.on('close', (code, reason) => {
          console.log(`[WebSocket] Connection closed - Code: ${code}, Reason: ${reason.toString()}`);
          activeConnections.delete(ws);
        });

        ws.on('error', (error) => {
          console.error('[WebSocket] Connection error:', error);
          activeConnections.delete(ws);
        });

        // Emit connection event to trigger stream handler
        wss.emit('connection', ws, request);
      });
    } catch (error) {
      console.error('[WebSocket Upgrade] Error during upgrade:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  } else {
    console.log(`[WebSocket Upgrade] Rejected - Invalid path: ${pathname}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// Middleware - Skip for WebSocket upgrade requests
app.use((req, res, next) => {
  // Skip all Express middleware for WebSocket upgrade requests
  // These are handled by server.on('upgrade')
  if (req.headers.upgrade?.toLowerCase() === 'websocket') {
    return; // Don't call next() - let the upgrade handler take over
  }
  next();
});

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health check endpoint
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'Voice Agent Server',
    activeConnections: activeConnections.size,
    timestamp: new Date().toISOString()
  });
});

// WebSocket status endpoint (use different path to avoid conflict with /streams WebSocket)
app.get('/streams-status', (req, res) => {
  res.json({
    endpoint: '/streams',
    type: 'WebSocket',
    status: 'ready',
    activeConnections: activeConnections.size,
    note: 'WebSocket endpoint is at /streams. Use ws:// or wss:// protocol to connect.'
  });
});

// Dashboard API routes
app.use('/api', dashboardRoutes);

/**
 * Twilio Voice Webhook Handler
 * Generates TwiML response to connect incoming call to WebSocket stream
 */
app.post('/voice', (req, res) => {
  try {
    console.log('[Voice Webhook] Incoming call received');
    console.log('[Voice Webhook] Call SID:', req.body.CallSid);
    console.log('[Voice Webhook] From:', req.body.From);
    console.log('[Voice Webhook] To:', req.body.To);

    // Create new TwiML response
    const response = new twilio.twiml.VoiceResponse();
    
    // Build WebSocket stream URL
    const streamUrl = buildStreamUrl(req);
    console.log('[Voice Webhook] Stream URL:', streamUrl);

    // Connect call to WebSocket stream
    // Bidirectional streaming is enabled by default when you send media events back
    response.connect().stream({ url: streamUrl });
    
    const twimlString = response.toString();
    console.log('[Voice Webhook] TwiML Response:\n', twimlString);

    // Set response headers
    res.type('text/xml');
    res.send(response.toString());
    
    console.log('[Voice Webhook] TwiML response sent');
  } catch (error) {
    console.error('[Voice Webhook] Error generating TwiML:', error);
    res.status(500).send('Error processing voice webhook');
  }
});

/**
 * WebSocket connection handler
 * Routes Twilio media stream to stream handler
 */
wss.on('connection', (ws: WebSocket, req) => {
  console.log('[WebSocket] New connection established');
  console.log('[WebSocket] Remote address:', req.socket.remoteAddress);
  console.log('[WebSocket] URL:', req.url);
  console.log('[WebSocket] Ready state:', ws.readyState);
  
  try {
    // Handle the Twilio media stream
    handleStream(ws);
  } catch (error) {
    console.error('[WebSocket] Error in stream handler:', error);
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1011, 'Internal server error');
    }
  }
});

// Graceful shutdown handler
const shutdown = () => {
  console.log('\n[Shutdown] Closing WebSocket connections...');
  activeConnections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1001, 'Server shutting down');
    }
  });
  
  wss.close(() => {
    console.log('[Shutdown] WebSocket server closed');
    server.close(() => {
      console.log('[Shutdown] HTTP server closed');
      process.exit(0);
    });
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Validate environment variables on startup
const requiredEnvVars = {
  ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY,
  DEEPGRAM_API_KEY: process.env.DEEPGRAM_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
};

console.log('[Server] Validating environment variables...');
let hasErrors = false;

for (const [key, value] of Object.entries(requiredEnvVars)) {
  if (!value) {
    console.error(`[Server] ❌ Missing required environment variable: ${key}`);
    hasErrors = true;
  } else {
    // Mask the API key for security (show first 8 chars and last 4)
    const masked = value.length > 12 
      ? `${value.substring(0, 8)}...${value.substring(value.length - 4)}`
      : '***';
    console.log(`[Server] ✓ ${key}: ${masked}`);
  }
}

if (hasErrors) {
  console.error('[Server] ⚠️  Some required environment variables are missing.');
  console.error('[Server] Please check your .env file and ensure all API keys are set.');
  console.error('[Server] Server will start, but features requiring missing keys will fail.');
}

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Voice Agent Server running on port ${PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/streams`);
  console.log(`[Server] Voice webhook: http://localhost:${PORT}/voice`);
});
