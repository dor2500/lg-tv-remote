// What the relay does, shared by the local Node server and the Cloudflare Worker: one TV and one phone per ID.
// It forwards sealed messages and cannot read them. A fake TV using someone's ID fails at the phone's password check.
const ID_PATTERN = /^\d{9}$/;
const MAX_MESSAGE_BYTES = 1000000;

function parsePath(pathname) {
  const match = /^\/(agent|client)\/(\d+)$/.exec(pathname);
  if (!match || !ID_PATTERN.test(match[2])) return null;
  return { role: match[1], id: match[2] };
}

// Decides what happens to a new connection. Sockets only need send() and close().
class Room {
  constructor() {
    this.agent = null;
    this.client = null;
  }

  accept(role, socket, token) {
    if (role === 'agent') {
      if (this.agent && this.agent.token !== token) return { close: 4001 };
      if (this.agent) this.agent.socket.close(4002);
      this.agent = { socket, token };
      return { ok: true };
    }
    if (!this.agent) return { refuse: 'no-tv' };
    if (this.client) return { refuse: 'busy' };
    this.client = socket;
    return { ok: true };
  }

  message(socket, data) {
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (size > MAX_MESSAGE_BYTES) return;
    if (this.agent && socket === this.agent.socket) {
      // The TV ends a phone that failed the password check, or sat on the only phone slot without trying.
      if (data === 'kick') {
        if (this.client) this.client.close(1000);
      } else if (this.client) {
        this.client.send(data);
      }
    } else if (socket === this.client && this.agent) {
      this.agent.socket.send(data);
    }
  }

  closed(socket) {
    if (this.agent && socket === this.agent.socket) {
      this.agent = null;
      if (this.client) {
        const client = this.client;
        this.client = null;
        client.send(JSON.stringify({ relay: 'no-tv' }));
        client.close(1000);
      }
    } else if (socket === this.client) {
      this.client = null;
      if (this.agent) this.agent.socket.send(JSON.stringify({ relay: 'peer-left' }));
    }
  }

  get empty() {
    return !this.agent && !this.client;
  }
}

module.exports = { Room, parsePath, MAX_MESSAGE_BYTES };
