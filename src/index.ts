import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import bodyParser from 'body-parser';
import dotenv from 'dotenv';
import dashboardRoutes from './routes/dashboardRoutes';
import { handleStream } from './services/streamHandler';

dotenv.config();

const app = express();
const server = createServer(app);
// Use noServer mode to handle upgrades manually
const wss = new WebSocketServer({ noServer: true });

// CRITICAL: Register upgrade handler - this fires BEFORE Express middleware
server.on('upgrade', (request, socket, head) => {
  console.log('=== UPGRADE REQUEST ===');
  console.log('URL:', request.url);
  console.log('Method:', request.method);
  console.log('Upgrade header:', request.headers.upgrade);
  
  // Parse URL - handle both with and without query parameters
  let pathname = '/';
  if (request.url) {
    try {
      // Try using URL constructor first
      const url = new URL(request.url, `http://${request.headers.host}`);
      pathname = url.pathname;
    } catch (e) {
      // Fallback: simple string split
      pathname = request.url.split('?')[0];
    }
  }

  console.log('Parsed pathname:', pathname);

  if (pathname === '/streams') {
    console.log('Handling WebSocket upgrade for /streams');
    try {
      wss.handleUpgrade(request, socket, head, (ws) => {
        console.log('WebSocket upgrade successful - connection established');
        wss.emit('connection', ws, request);
      });
    } catch (error) {
      console.error('Error handling upgrade:', error);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    }
  } else {
    console.log('Invalid upgrade path:', pathname);
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// DO NOT add Express route for /streams - WebSocket upgrades are handled by server.on('upgrade')

// Health check
app.get('/', (req, res) => {
  res.send('Voice Agent Server Running');
});

// Dashboard API
app.use('/api', dashboardRoutes);

// Voice TwiML Route
app.post('/voice', (req, res) => {
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  // Note: For WSS, if behind ngrok https, use wss.
  const wsProtocol = protocol === 'https' ? 'wss' : 'ws';
  
  const twiml = `
    <Response>
      <Connect>
        <Stream url="${wsProtocol}://${host}/streams" />
      </Connect>
    </Response>
  `;
  res.type('text/xml');
  res.send(twiml);
});

// WebSocket Handling
wss.on('connection', (ws, req) => {
  console.log('WebSocket Connection Established');
  handleStream(ws);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
