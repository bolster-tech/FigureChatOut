const express = require('express');
const http = require('http');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const app = express();
const PORT = process.env.PORT || 3000;

// 1. Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Create an HTTP server to integrate with Express
const server = http.createServer(app);

// 2. Set up WebSocket server on port 3000 (attached to HTTP server)
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
  // Listen for incoming messages
  ws.on('message', (message, isBinary) => {
    // Immediately broadcast incoming messages to all other connected clients
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message, { binary: isBinary });
      }
    });
  });
});

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

