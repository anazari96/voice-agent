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

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

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

// Manual Upgrade Handling
server.on('upgrade', (request, socket, head) => {
  console.log('Received upgrade request:', request.url);
  
  // Parse URL to ignore query parameters
  const pathname = request.url ? request.url.split('?')[0] : '';

  if (pathname === '/streams') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    console.log('Invalid upgrade path:', pathname);
    socket.destroy();
  }
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
