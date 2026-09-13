const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');
const { Server: SocketIOServer } = require('socket.io');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

const DEFAULT_ROOM = 'lobby';
const ROOM_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function normalizeRoomCode(value) {
  const roomCode = String(value || '').trim();
  return ROOM_PATTERN.test(roomCode) ? roomCode : DEFAULT_ROOM;
}

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
  socket.roomCode = DEFAULT_ROOM;
  socket.join(DEFAULT_ROOM);

  socket.on('join-room', (requestedRoom) => {
    const roomCode = normalizeRoomCode(
      typeof requestedRoom === 'object' ? requestedRoom.roomCode : requestedRoom
    );

    if (socket.roomCode) {
      socket.leave(socket.roomCode);
    }

    socket.roomCode = roomCode;
    socket.join(roomCode);
    socket.emit('room-joined', { roomCode });
  });

  socket.onAny((eventName, ...args) => {
    if (eventName === 'join-room' || eventName === 'room-joined') {
      return;
    }

    const payload = args[0] && typeof args[0] === 'object' ? args[0] : {};
    const roomCode = socket.roomCode || DEFAULT_ROOM;

    if (args[0] && typeof args[0] === 'object') {
      args[0] = { ...args[0], roomCode };
    } else if (args.length === 0) {
      args.push({ roomCode });
    }

    io.to(roomCode).emit(eventName, ...args);
  });

  socket.on('disconnect', () => {
    socket.roomCode = null;
  });
});

// Native WebSocket transport used by the existing board and host scripts.
const wss = new WebSocketServer({ noServer: true });
const wsRooms = new Map();

function removeWsFromRoom(ws) {
  if (!ws.roomCode) return;

  const clients = wsRooms.get(ws.roomCode);
  if (clients) {
    clients.delete(ws);
    if (clients.size === 0) {
      wsRooms.delete(ws.roomCode);
    }
  }

  ws.roomCode = null;
}

function joinWsRoom(ws, requestedRoom) {
  removeWsFromRoom(ws);

  const roomCode = normalizeRoomCode(requestedRoom);
  let clients = wsRooms.get(roomCode);

  if (!clients) {
    clients = new Set();
    wsRooms.set(roomCode, clients);
  }

  ws.roomCode = roomCode;
  clients.add(ws);
  ws.send(JSON.stringify({
    action: 'room-joined',
    roomCode
  }));
}

wss.on('connection', (ws) => {
  ws.roomCode = null;

  ws.on('message', (message, isBinary) => {
    let payload;

    try {
      payload = JSON.parse(message.toString());
    } catch {
      return;
    }

    if (payload.action === 'join-room') {
      joinWsRoom(ws, payload.roomCode);
      return;
    }

    if (!ws.roomCode) {
      joinWsRoom(ws, DEFAULT_ROOM);
    }

    const roomCode = ws.roomCode;
    const outgoingPayload = {
      ...payload,
      roomCode
    };
    const encodedPayload = JSON.stringify(outgoingPayload);
    const clients = wsRooms.get(roomCode);

    if (!clients) return;

    clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(encodedPayload, { binary: isBinary });
      }
    });
  });

  ws.on('close', () => {
    removeWsFromRoom(ws);
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