import net from 'node:net';
import path from 'node:path';

// Discord desktop IPC framing: 8-byte little-endian header (opcode, payload
// length) followed by a JSON payload. That's the whole protocol, so we speak
// it directly rather than pulling in an RPC dependency.
const OP_HANDSHAKE = 0;
const OP_FRAME = 1;

const RECONNECT_MS = 15000;
// Discord allows roughly 5 presence updates per 20s; coalesce below that.
const MIN_SEND_GAP_MS = 4500;
// Recomputed start timestamps jitter by polling latency; only resend when
// playback position moved further than a seek-sized jump.
const DRIFT_MS = 4000;
const ACTIVITY_TYPE_LISTENING = 2;

function encode(op, payload) {
  const json = Buffer.from(JSON.stringify(payload));
  const header = Buffer.alloc(8);
  header.writeUInt32LE(op, 0);
  header.writeUInt32LE(json.length, 4);
  return Buffer.concat([header, json]);
}

function socketCandidates() {
  if (process.env.DISCORD_IPC_PATH) return [process.env.DISCORD_IPC_PATH];
  const candidates = [];
  const bases = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, '/tmp'].filter(Boolean);
  // Flatpak and snap installs keep the socket under an app-scoped subdir.
  const subdirs = ['', 'app/com.discordapp.Discord', 'snap.discord'];
  for (const base of bases) {
    for (const sub of subdirs) {
      for (let i = 0; i < 10; i++) candidates.push(path.join(base, sub, `discord-ipc-${i}`));
    }
  }
  return candidates;
}

function hmsToSeconds(hms) {
  if (!hms) return null;
  const parts = String(hms).split(':').map(Number);
  if (parts.length === 0 || parts.some(Number.isNaN)) return null;
  return parts.reduce((acc, part) => acc * 60 + part, 0);
}

// Discord rejects string fields shorter than 2 or longer than 128 chars.
function clampText(value) {
  const text = String(value ?? '').trim();
  if (!text) return undefined;
  return text.length < 2 ? text.padEnd(2) : text.slice(0, 128);
}

export class DiscordPresence {
  constructor(clientId) {
    this.clientId = clientId;
    this.socket = null;
    this.ready = false;
    this.buffer = Buffer.alloc(0);
    this.nonce = 0;
    this.shownRenderer = null;
    this.desired = undefined; // activity to show; null = clear; undefined = nothing pending
    this.lastSent = undefined;
    this.lastSendAt = 0;
    this.sendTimer = null;
    this.reconnectTimer = null;
    this.stopped = false;
  }

  start() {
    if (!this.clientId) {
      console.log('Discord presence disabled (set DISCORD_CLIENT_ID to enable)');
      return;
    }
    this._connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.sendTimer);
    clearTimeout(this.reconnectTimer);
    this.socket?.destroy();
  }

  onQueueState(state) {
    if (!this.clientId) return;
    const track = state.currentIndex >= 0 ? state.tracks[state.currentIndex] : null;
    if (track && state.transportState === 'PLAYING') {
      this.shownRenderer = state.rendererUdn;
      this._setDesired(this._buildActivity(track, state.position));
    } else if (state.rendererUdn === this.shownRenderer) {
      this.shownRenderer = null;
      this._setDesired(null);
    }
  }

  _buildActivity(track, position) {
    const activity = {
      type: ACTIVITY_TYPE_LISTENING,
      details: clampText(track.title) ?? 'Unknown track',
      assets: { large_image: 'cover' },
    };
    const artist = clampText(track.artist);
    if (artist) activity.state = artist;
    const album = clampText(track.album);
    if (album) activity.assets.large_text = album;

    const duration = hmsToSeconds(position?.duration);
    const elapsed = hmsToSeconds(position?.relTime);
    if (duration > 0 && elapsed !== null) {
      const start = Date.now() - elapsed * 1000;
      activity.timestamps = { start, end: start + duration * 1000 };
    }
    return activity;
  }

  _setDesired(activity) {
    if (this._sameActivity(activity, this.desired === undefined ? this.lastSent : this.desired)) return;
    this.desired = activity;
    this._scheduleSend();
  }

  _sameActivity(a, b) {
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    if (a.details !== b.details || a.state !== b.state) return false;
    const aStart = a.timestamps?.start;
    const bStart = b.timestamps?.start;
    if ((aStart === undefined) !== (bStart === undefined)) return false;
    return aStart === undefined || Math.abs(aStart - bStart) < DRIFT_MS;
  }

  _scheduleSend() {
    if (!this.ready || this.desired === undefined || this.sendTimer) return;
    const wait = Math.max(0, this.lastSendAt + MIN_SEND_GAP_MS - Date.now());
    this.sendTimer = setTimeout(() => {
      this.sendTimer = null;
      this._flush();
    }, wait);
  }

  _flush() {
    if (!this.ready || this.desired === undefined) return;
    const activity = this.desired;
    this.desired = undefined;
    this.lastSent = activity;
    this.lastSendAt = Date.now();
    const args = { pid: process.pid };
    if (activity) args.activity = activity;
    this._send(OP_FRAME, { cmd: 'SET_ACTIVITY', args, nonce: `np-${++this.nonce}` });
  }

  _send(op, payload) {
    try {
      this.socket?.write(encode(op, payload));
    } catch {
      // socket died mid-write; the close handler takes care of reconnecting
    }
  }

  _connect(candidateIndex = 0) {
    if (this.stopped) return;
    const candidates = socketCandidates();
    if (candidateIndex >= candidates.length) {
      this._scheduleReconnect();
      return;
    }
    const socket = net.connect(candidates[candidateIndex]);
    socket.on('connect', () => {
      this.socket = socket;
      this.buffer = Buffer.alloc(0);
      socket.on('data', (chunk) => this._onData(chunk));
      this._send(OP_HANDSHAKE, { v: 1, client_id: this.clientId });
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      if (this.socket === socket) {
        const wasReady = this.ready;
        this.socket = null;
        this.ready = false;
        if (wasReady) console.log('Discord presence: connection lost, will retry');
        this._scheduleReconnect();
      } else if (!this.stopped) {
        // never got past connect on this candidate; try the next path
        this._connect(candidateIndex + 1);
      }
    });
  }

  _scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._connect();
    }, RECONNECT_MS);
  }

  _onData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 8) {
      const length = this.buffer.readUInt32LE(4);
      if (this.buffer.length < 8 + length) break;
      const body = this.buffer.subarray(8, 8 + length);
      this.buffer = this.buffer.subarray(8 + length);
      let message;
      try {
        message = JSON.parse(body.toString());
      } catch {
        continue;
      }
      this._onMessage(message);
    }
  }

  _onMessage(message) {
    if (message.evt === 'READY') {
      this.ready = true;
      console.log('Discord presence connected');
      // re-assert current state after a reconnect
      if (this.desired === undefined && this.lastSent !== undefined) this.desired = this.lastSent;
      this._scheduleSend();
    } else if (message.evt === 'ERROR') {
      console.warn(`Discord presence error: ${message.data?.message ?? 'unknown'}`);
    }
  }
}
