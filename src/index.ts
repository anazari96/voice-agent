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
 * This must be registered before Express middleware to intercept upgrade requests
 */
server.on('upgrade', (request, socket, head) => {
  const url = request.url || '/';
  let pathname: string;

  try {
    const parsedUrl = new URL(url, `http://${request.headers.host}`);
    pathname = parsedUrl.pathname;
  } catch (e) {
    // Fallback for malformed URLs
    pathname = url.split('?')[0];
  }

  console.log(`[WebSocket Upgrade] Path: ${pathname}, Origin: ${request.headers.origin}`);

  // Only allow connections to /streams endpoint
  if (pathname === '/streams') {
    wss.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      console.log('[WebSocket] Connection established from Twilio');
      activeConnections.add(ws);
      
      // Handle connection cleanup
      ws.on('close', () => {
        console.log('[WebSocket] Connection closed');
        activeConnections.delete(ws);
      });

      ws.on('error', (error) => {
        console.error('[WebSocket] Error:', error);
        activeConnections.delete(ws);
      });

      // Emit connection event to trigger stream handler
      wss.emit('connection', ws, request);
    });
  } else {
    console.log(`[WebSocket Upgrade] Rejected - Invalid path: ${pathname}`);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// Middleware
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
    const connect = response.connect();
    connect.stream({ url: streamUrl });

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

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[Server] Voice Agent Server running on port ${PORT}`);
  console.log(`[Server] WebSocket endpoint: ws://localhost:${PORT}/streams`);
  console.log(`[Server] Voice webhook: http://localhost:${PORT}/voice`);
});
