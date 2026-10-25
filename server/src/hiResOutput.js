import { spawn, execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { readFile, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const CARD_POLL_MS = 3000;

function relTime(seconds) {
  const s = Math.max(0, Math.floor(seconds ?? 0));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function parseRelTime(value) {
  return String(value)
    .split(':')
    .reduce((total, part) => total * 60 + Number(part), 0);
}

// e.g. " 3 [Headphone      ]: USB-Audio - Nothing Headphone (1)"
async function usbCards() {
  const text = await readFile('/proc/asound/cards', 'utf-8').catch(() => '');
  const cards = [];
  for (const m of text.matchAll(/^\s*(\d+)\s+\[(\S+)\s*\]:\s+(\S+)\s+-\s+(.+)$/gm)) {
    const [, index, id, driver, name] = m;
    if (driver === 'USB-Audio') cards.push({ index: Number(index), id, name: name.trim() });
  }
  return cards;
}

// What the DAC is actually running at while open, from the kernel; null
// when the device is closed.
async function hwParams(cardIndex) {
  const text = await readFile(`/proc/asound/card${cardIndex}/pcm0p/sub0/hw_params`, 'utf-8').catch(() => 'closed');
  if (text.trim() === 'closed') return null;
  const field = (name) => text.match(new RegExp(`^${name}:\\s*(\\S+)`, 'm'))?.[1];
  return { format: field('format'), rate: Number(field('rate')), channels: Number(field('channels')) };
}

// One mpv process per DAC, opened exclusively on the raw ALSA device with no
// config, filters, resampling or software volume, so samples reach the DAC
// unchanged. Controlled over mpv's JSON IPC socket.
class MpvDriver {
  constructor(card) {
    this.card = card;
    this.socketPath = path.join(os.tmpdir(), `hificommander-mpv-${card.id}.sock`);
    this.props = { idle: true, pause: false, timePos: 0, duration: 0 };
    this.pending = new Map();
    this.nextId = 1;
    this.mixer = undefined; // ALSA hardware volume control name, null if none
  }

  async _ensure() {
    if (this.socket && !this.socket.destroyed) return;
    await rm(this.socketPath, { force: true });
    const device = this.card.test ? [] : [`--audio-device=alsa/hw:CARD=${this.card.id}`, '--audio-exclusive=yes'];
    this.proc = spawn(
      'mpv',
      [
        '--idle=yes',
        '--no-config',
        '--no-video',
        '--no-terminal',
        '--volume=100',
        '--volume-max=100',
        '--replaygain=no',
        `--input-ipc-server=${this.socketPath}`,
        ...(this.card.test ? ['--ao=null'] : device),
      ],
      { stdio: 'ignore' }
    );
    this.proc.on('exit', () => {
      this.socket?.destroy();
      this.socket = null;
      this.props.idle = true;
    });
    this.socket = await this._connect();
    let buffer = '';
    this.socket.on('data', (chunk) => {
      buffer += chunk;
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        this._onMessage(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
    });
    for (const [i, name] of ['idle-active', 'pause', 'time-pos', 'duration'].entries()) {
      this._send(['observe_property', i + 1, name]);
    }
  }

  async _connect() {
    for (let attempt = 0; attempt < 50; attempt++) {
      try {
        return await new Promise((resolve, reject) => {
          const socket = net.connect(this.socketPath, () => resolve(socket));
          socket.once('error', reject);
        });
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error('mpv did not start');
  }

  _onMessage(msg) {
    if (msg.event === 'property-change') {
      const key = { 'idle-active': 'idle', pause: 'pause', 'time-pos': 'timePos', duration: 'duration' }[msg.name];
      if (key) this.props[key] = msg.data ?? (key === 'idle' ? true : 0);
    } else if (msg.request_id && this.pending.has(msg.request_id)) {
      const { resolve, reject } = this.pending.get(msg.request_id);
      this.pending.delete(msg.request_id);
      msg.error === 'success' ? resolve(msg.data) : reject(new Error(`mpv: ${msg.error}`));
    }
  }

  _send(command) {
    const request_id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(request_id, { resolve, reject });
      this.socket.write(JSON.stringify({ command, request_id }) + '\n');
    });
  }

  async _command(...command) {
    await this._ensure();
    return this._send(command);
  }

  async playTrack(track) {
    await this._command('loadfile', track.res.uri, 'replace');
    await this._command('set_property', 'pause', false);
    this.props.idle = false;
  }

  play() {
    return this._command('set_property', 'pause', false);
  }

  pause() {
    return this._command('set_property', 'pause', true);
  }

  async stop() {
    if (!this.socket) return;
    await this._command('stop');
  }

  seek(target) {
    return this._command('seek', parseRelTime(target), 'absolute');
  }

  async getTransportInfo() {
    const state = !this.socket || this.props.idle ? 'STOPPED' : this.props.pause ? 'PAUSED_PLAYBACK' : 'PLAYING';
    return { state };
  }

  async getPositionInfo() {
    return { relTime: relTime(this.props.timePos), duration: relTime(this.props.duration) };
  }

  // Volume is set on the DAC's own hardware control when it has one, which
  // leaves the digital signal untouched. Without one it stays at 100.
  async _findMixer() {
    if (this.mixer !== undefined) return this.mixer;
    if (this.card.test) return (this.mixer = null);
    const { stdout } = await run('amixer', ['-c', String(this.card.index), 'scontents']).catch(() => ({ stdout: '' }));
    const control = stdout
      .split(/^Simple mixer control /m)
      .find((block) => /Capabilities:.*\bp?volume\b/.test(block) && /Playback/.test(block));
    this.mixer = control?.match(/^'([^']+)'/)?.[1] ?? null;
    return this.mixer;
  }

  get volumeFixed() {
    return this.mixer === null;
  }

  async getVolume() {
    const mixer = await this._findMixer();
    if (!mixer) return 100;
    const { stdout } = await run('amixer', ['-c', String(this.card.index), 'sget', mixer]);
    return Number(stdout.match(/\[(\d+)%\]/)?.[1] ?? 100);
  }

  async setVolume(volume) {
    const mixer = await this._findMixer();
    if (mixer) await run('amixer', ['-c', String(this.card.index), 'sset', mixer, `${volume}%`]);
  }

  async getMute() {
    return false;
  }

  async setMute(muted) {
    const mixer = await this._findMixer();
    if (mixer) await run('amixer', ['-c', String(this.card.index), 'sset', mixer, muted ? 'mute' : 'unmute']).catch(() => {});
  }

  async signal() {
    if (this.card.test) return null;
    return hwParams(this.card.index);
  }

  dispose() {
    this.proc?.kill();
    this.socket?.destroy();
  }
}

// Watches for USB audio devices and offers each as a "DAC" renderer while
// it's plugged in. HIFI_HIRES_TEST=1 adds a silent test output.
export class HiResOutputs extends EventEmitter {
  constructor() {
    super();
    this.drivers = new Map(); // card id -> MpvDriver
  }

  async start() {
    const hasMpv = await run('mpv', ['--version']).then(() => true, () => false);
    if (!hasMpv) {
      console.warn('mpv not found; hi-res output disabled');
      return;
    }
    await this._poll();
    this._timer = setInterval(() => this._poll(), CARD_POLL_MS);
  }

  async _poll() {
    const cards = await usbCards();
    if (process.env.HIFI_HIRES_TEST) cards.push({ index: -1, id: 'test', name: 'Hi-Res Test (silent)', test: true });
    const ids = new Set(cards.map((c) => c.id));
    let changed = false;
    for (const card of cards) {
      if (!this.drivers.has(card.id)) {
        this.drivers.set(card.id, new MpvDriver(card));
        changed = true;
      }
    }
    for (const [id, driver] of this.drivers) {
      if (!ids.has(id)) {
        driver.dispose();
        this.drivers.delete(id);
        changed = true;
      }
    }
    if (changed) this.emit('change', this.renderers());
  }

  renderers() {
    return [...this.drivers.values()].map((driver) => ({
      udn: `hires:${driver.card.id}`,
      friendlyName: driver.card.name,
      driver,
    }));
  }

  stop() {
    clearInterval(this._timer);
    for (const driver of this.drivers.values()) driver.dispose();
  }
}
