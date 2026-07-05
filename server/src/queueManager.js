import { EventEmitter } from 'node:events';
import { playTrack, stop as transportStop, getTransportInfo, getPositionInfo } from './avTransport.js';

const POLL_MS = 2000;
// Ignore transport-state transitions for a short window after we issue our
// own command, so the SetAVTransportURI/Play/Stop round-trip (which briefly
// reports TRANSITIONING/STOPPED on its own) can't be mistaken for a track
// ending naturally and trigger a bogus auto-advance.
const COMMAND_COOLDOWN_MS = 2500;

function emptyQueueState() {
  return {
    tracks: [],
    currentIndex: -1,
    active: false, // true only while we expect auto-advance to fire on track end
    lastKnownState: null,
    lastCommandAt: 0,
    repeat: false, // when the queue reaches the end, start over from track 0 instead of stopping
  };
}

export class QueueManager extends EventEmitter {
  constructor(registry) {
    super();
    this.registry = registry;
    this.queues = new Map(); // rendererUdn -> queue state
  }

  start() {
    this._pollTimer = setInterval(() => this._pollAll(), POLL_MS);
  }

  stop() {
    clearInterval(this._pollTimer);
  }

  _getQueue(rendererUdn) {
    if (!this.queues.has(rendererUdn)) this.queues.set(rendererUdn, emptyQueueState());
    return this.queues.get(rendererUdn);
  }

  _getRenderer(rendererUdn) {
    const renderer = this.registry.getDevice(rendererUdn);
    if (!renderer) throw new Error('Unknown renderer');
    return renderer;
  }

  async playNow(rendererUdn, tracks, startIndex = 0) {
    const renderer = this._getRenderer(rendererUdn);
    const queue = this._getQueue(rendererUdn);
    queue.tracks = tracks;
    queue.currentIndex = startIndex;
    queue.active = true;
    queue.lastKnownState = null;
    queue.lastCommandAt = Date.now();
    await playTrack(renderer, tracks[startIndex]);
    this._emitState(rendererUdn);
  }

  addToQueue(rendererUdn, tracks) {
    const queue = this._getQueue(rendererUdn);
    queue.tracks.push(...tracks);
    this._emitState(rendererUdn);
  }

  async next(rendererUdn) {
    const queue = this._getQueue(rendererUdn);
    if (queue.currentIndex + 1 >= queue.tracks.length) {
      if (queue.repeat && queue.tracks.length > 0) await this._advanceTo(rendererUdn, 0);
      return;
    }
    await this._advanceTo(rendererUdn, queue.currentIndex + 1);
  }

  setRepeat(rendererUdn, repeat) {
    const queue = this._getQueue(rendererUdn);
    queue.repeat = repeat;
    this._emitState(rendererUdn);
  }

  async previous(rendererUdn) {
    const queue = this._getQueue(rendererUdn);
    if (queue.currentIndex <= 0) return;
    await this._advanceTo(rendererUdn, queue.currentIndex - 1);
  }

  async jumpTo(rendererUdn, index) {
    const queue = this._getQueue(rendererUdn);
    if (index < 0 || index >= queue.tracks.length) return;
    await this._advanceTo(rendererUdn, index);
  }

  async _advanceTo(rendererUdn, index) {
    const renderer = this._getRenderer(rendererUdn);
    const queue = this._getQueue(rendererUdn);
    queue.currentIndex = index;
    queue.active = true;
    queue.lastCommandAt = Date.now();
    await playTrack(renderer, queue.tracks[index]);
    this._emitState(rendererUdn);
  }

  // Full clear-down: stop playback and empty the queue so nothing is left
  // around to be picked up by a stray auto-advance later.
  async stopAndClear(rendererUdn) {
    const renderer = this._getRenderer(rendererUdn);
    const queue = this._getQueue(rendererUdn);
    queue.tracks = [];
    queue.currentIndex = -1;
    queue.active = false;
    queue.lastKnownState = null;
    queue.lastCommandAt = Date.now();
    await transportStop(renderer);
    this._emitState(rendererUdn);
  }

  getState(rendererUdn) {
    const queue = this._getQueue(rendererUdn);
    return {
      tracks: queue.tracks,
      currentIndex: queue.currentIndex,
      active: queue.active,
      transportState: queue.lastKnownState,
      repeat: queue.repeat,
    };
  }

  _emitState(rendererUdn) {
    this.emit('state', { rendererUdn, ...this.getState(rendererUdn) });
  }

  async _pollAll() {
    for (const rendererUdn of this.queues.keys()) {
      await this._pollOne(rendererUdn).catch(() => {
        // renderer unreachable this tick; try again next poll
      });
    }
  }

  async _pollOne(rendererUdn) {
    const queue = this._getQueue(rendererUdn);
    const renderer = this.registry.getDevice(rendererUdn);
    if (!renderer) return;

    const withinCooldown = Date.now() - queue.lastCommandAt < COMMAND_COOLDOWN_MS;
    const { state } = await getTransportInfo(renderer);
    const position = await getPositionInfo(renderer).catch(() => null);

    const previousState = queue.lastKnownState;
    queue.lastKnownState = state;

    const trackEnded = !withinCooldown && previousState === 'PLAYING' && state === 'STOPPED';

    if (trackEnded && queue.active) {
      if (queue.currentIndex + 1 < queue.tracks.length) {
        await this._advanceTo(rendererUdn, queue.currentIndex + 1);
        return;
      }
      if (queue.repeat && queue.tracks.length > 0) {
        await this._advanceTo(rendererUdn, 0);
        return;
      }
      // Queue finished naturally; nothing left to auto-advance to.
      queue.active = false;
    }

    this.emit('state', { rendererUdn, ...this.getState(rendererUdn), position });
  }
}
