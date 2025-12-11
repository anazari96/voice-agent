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
const wss = new WebSocketServer({ server });

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Dashboard API
app.use('/api', dashboardRoutes);

// Voice TwiML Route
app.post('/voice', (req, res) => {
  const host = req.headers.host;
  const protocol = req.headers['x-forwarded-proto'] || 'http';
  // Note: For WSS, if behind ngrok https, use wss.
  // We'll guess based on proto.
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
  const path = req.url;
  if (path === '/streams') {
    handleStream(ws);
  } else {
    ws.close();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

