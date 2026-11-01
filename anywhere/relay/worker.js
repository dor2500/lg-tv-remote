// The relay on Cloudflare Workers. Each ID gets its own Durable Object.
// Sockets use the hibernation API, so an idle TV waiting for a phone costs no running time.
import { DurableObject } from 'cloudflare:workers';
import { parsePath, MAX_MESSAGE_BYTES } from './room.js';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = parsePath(url.pathname);
    if (!target) return new Response('TV Anywhere relay');
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    return env.ROOMS.get(env.ROOMS.idFromName(target.id)).fetch(request);
  },
};

export class RoomObject extends DurableObject {
  constructor(state, env) {
    super(state, env);
    this.state = state;
    this.state.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  _socket(tag) {
    return this.state.getWebSockets(tag)[0] || null;
  }

  async fetch(request) {
    const url = new URL(request.url);
    const { role } = parsePath(url.pathname);
    const token = url.searchParams.get('token') || '';
    const pair = new WebSocketPair();
    const [outside, inside] = Object.values(pair);
    this.state.acceptWebSocket(inside, [role]);

    if (role === 'agent') {
      const current = this.state.getWebSockets('agent').filter((socket) => socket !== inside);
      for (const socket of current) {
        const same = socket.deserializeAttachment() === token;
        (same ? socket : inside).close(same ? 4002 : 4001);
        if (!same) return new Response(null, { status: 101, webSocket: outside });
      }
      inside.serializeAttachment(token);
    } else {
      const refuse = !this._socket('agent') ? 'no-tv' : this.state.getWebSockets('client').length > 1 ? 'busy' : null;
      if (refuse) {
        inside.send(JSON.stringify({ relay: refuse }));
        inside.close(1000);
      }
    }
    return new Response(null, { status: 101, webSocket: outside });
  }

  async webSocketMessage(socket, data) {
    const size = typeof data === 'string' ? data.length : data.byteLength;
    if (size > MAX_MESSAGE_BYTES) return;
    const [role] = this.state.getTags(socket);
    const other = this._socket(role === 'agent' ? 'client' : 'agent');
    if (!other) return;
    if (role === 'agent' && data === 'kick') other.close(1000);
    else other.send(data);
  }

  async webSocketClose(socket) {
    const [role] = this.state.getTags(socket);
    try {
      socket.close(1000);
    } catch {
      // Already closed.
    }
    if (role === 'agent') {
      // A replacement from the same TV doesn't end the phone's session.
      if (this.state.getWebSockets('agent').some((s) => s !== socket && s.readyState === 1)) return;
      for (const client of this.state.getWebSockets('client')) {
        client.send(JSON.stringify({ relay: 'no-tv' }));
        client.close(1000);
      }
    } else {
      const agent = this._socket('agent');
      if (agent) agent.send(JSON.stringify({ relay: 'peer-left' }));
    }
  }

  async webSocketError(socket) {
    await this.webSocketClose(socket);
  }
}
