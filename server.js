const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { Server: SocketIOServer } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

// Explicit page routes.
app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'board.html'));
});

app.get('/board', (req, res) => {
  res.sendFile(path.join(publicDir, 'board.html'));
});

app.get('/host', (req, res) => {
  res.sendFile(path.join(publicDir, 'host.html'));
});

// Serve client assets after page routes.
app.use(express.static(publicDir));

// Socket.io transport.
const io = new SocketIOServer(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

io.on('connection', (socket) => {
  socket.onAny((event, ...args) => {
    socket.broadcast.emit(event, ...args);
  });
});

// Native WebSocket transport used by the existing board and host scripts.
// Keep it separate from Socket.io's /socket.io/ upgrade path.
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (message, isBinary) => {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message, { binary: isBinary });
      }
    });
  });
});

server.on('upgrade', (request, socket, head) => {
  const pathname = new URL(request.url, `http://${request.headers.host}`).pathname;

  if (pathname.startsWith('/socket.io/')) {
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request);
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});