// The relay as a plain Node server, for tests and for anyone hosting it themselves.
const http = require('node:http');
const { WebSocketServer } = require('ws');
const { Room, parsePath, MAX_MESSAGE_BYTES } = require('./room');

function startRelay({ port = 8787, host = '0.0.0.0' } = {}) {
  const rooms = new Map();
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('TV Anywhere relay');
  });
  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES * 2 });

  wss.on('connection', (socket, req) => {
    const url = new URL(req.url, 'http://relay');
    const target = parsePath(url.pathname);
    if (!target) {
      socket.close(4000);
      return;
    }
    let room = rooms.get(target.id);
    if (!room) {
      room = new Room();
      rooms.set(target.id, room);
    }
    const result = room.accept(target.role, socket, url.searchParams.get('token'));
    if (result.refuse) {
      socket.send(JSON.stringify({ relay: result.refuse }));
      socket.close(1000);
      return;
    }
    if (result.close) {
      socket.close(result.close);
      return;
    }
    socket.on('message', (data, isBinary) => {
      const text = isBinary ? data : data.toString();
      if (text === 'ping') socket.send('pong');
      else room.message(socket, text);
    });
    socket.on('close', () => {
      room.closed(socket);
      if (room.empty) rooms.delete(target.id);
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(port, host, () => resolve({
      port: server.address().port,
      close: () => new Promise((done) => {
        for (const client of wss.clients) client.terminate();
        server.close(done);
      }),
    }));
  });
}

if (require.main === module) {
  startRelay({ port: Number(process.env.PORT) || 8787 }).then(({ port }) => console.log(`Relay listening on ${port}`));
}

module.exports = { startRelay };
