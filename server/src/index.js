import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { DeviceRegistry } from './ssdp.js';
import { ExtraDiscovery } from './discovery.js';
import { LocalLibrary, LOCAL_LIBRARY_UDN } from './localLibrary.js';
import { QueueManager } from './queueManager.js';
import { browse } from './contentDirectory.js';
import { pause, play, seek } from './avTransport.js';
import { getVolume, setVolume, getMute, setMute } from './renderingControl.js';
import { loadPinnedLocations, savePinnedLocations } from './pinnedStore.js';
import { loadVolumeLimits, saveVolumeLimits } from './volumeLimitStore.js';
import { DiscordPresence } from './discordPresence.js';

const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const registry = new DeviceRegistry();
const extraDiscovery = new ExtraDiscovery(registry);
const localLibrary = new LocalLibrary(PORT);
registry.extraServers = () => [localLibrary.summary()];
const queueManager = new QueueManager(registry);
const discordPresence = new DiscordPresence(process.env.DISCORD_CLIENT_ID);
let volumeLimits = {}; // rendererUdn -> max volume (1-100)

const app = express();
app.use(express.json());

function requireDevice(kindGetter) {
  return (req, res, next) => {
    const device = kindGetter(req);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    req.device = device;
    next();
  };
}

app.get('/api/devices', (req, res) => {
  res.json(registry.getDevices());
});

app.post('/api/devices/rescan', (req, res) => {
  extraDiscovery.rescan();
  registry.rescan();
  res.json({ ok: true });
});

app.delete('/api/devices/known/:udn', (req, res) => {
  if (!extraDiscovery.forget(req.params.udn)) return res.status(404).json({ error: 'Device not found' });
  res.json({ ok: true });
});

app.post('/api/devices/pinned', async (req, res) => {
  try {
    const info = await registry.addPinned(req.body.location);
    await savePinnedLocations(registry.getPinnedLocations());
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Edit: the new URL must answer before the old one is dropped, so a typo
// can't lose a working pin.
app.put('/api/devices/pinned', async (req, res) => {
  const { from, location } = req.body;
  if (!registry.getPinnedLocations().includes(from)) {
    return res.status(404).json({ error: 'Pinned device not found' });
  }
  try {
    const info = await registry.addPinned(location);
    if (location !== from) registry.removePinned(from);
    await savePinnedLocations(registry.getPinnedLocations());
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/devices/pinned', async (req, res) => {
  const removed = registry.removePinned(req.query.location);
  if (!removed) return res.status(404).json({ error: 'Pinned device not found' });
  await savePinnedLocations(registry.getPinnedLocations());
  res.json({ ok: true });
});

// DLNA-style headers so renderers treat these as seekable streams.
const DLNA_STREAM_HEADERS = {
  'transferMode.dlna.org': 'Streaming',
  'contentFeatures.dlna.org': 'DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000',
};

app.get('/api/local/stream/:file', (req, res) => {
  const file = localLibrary.trackFile(path.parse(req.params.file).name);
  if (!file) return res.status(404).end();
  res.sendFile(file.path, { headers: { 'Content-Type': file.mime, ...DLNA_STREAM_HEADERS } });
});

app.get(['/api/local/art/:albumKey', '/api/local/art/track/:trackId'], async (req, res) => {
  const art = req.params.trackId
    ? await localLibrary.trackArt(req.params.trackId)
    : await localLibrary.albumArt(req.params.albumKey);
  if (!art) return res.status(404).end();
  res.set('Cache-Control', 'max-age=86400');
  if (art.file) return res.sendFile(art.file);
  res.type(art.mime).send(art.data);
});

app.get('/api/local/folders', (req, res) => {
  res.json(localLibrary.summary());
});

app.put('/api/local/folders', async (req, res) => {
  try {
    await localLibrary.setFolders(req.body.folders ?? []);
    res.json(localLibrary.summary());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/local/rescan', (req, res) => {
  localLibrary.rescan();
  res.json({ ok: true });
});

app.get('/api/browse', (req, res, next) => {
  if (req.query.server !== LOCAL_LIBRARY_UDN) return next();
  res.json({ items: localLibrary.browse(req.query.id ?? '0') });
});

app.get(
  '/api/browse',
  requireDevice((req) => registry.getDevice(req.query.server)),
  async (req, res) => {
    try {
      const result = await browse(req.device, { objectId: req.query.id ?? '0' });
      res.json(result);
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.get('/api/queue/:rendererUdn', (req, res) => {
  res.json(queueManager.getState(req.params.rendererUdn));
});

app.post('/api/queue/:rendererUdn/play', async (req, res) => {
  try {
    await queueManager.playNow(req.params.rendererUdn, req.body.tracks, req.body.startIndex ?? 0);
    res.json(queueManager.getState(req.params.rendererUdn));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/queue/:rendererUdn/add', (req, res) => {
  queueManager.addToQueue(req.params.rendererUdn, req.body.tracks);
  res.json(queueManager.getState(req.params.rendererUdn));
});

app.post('/api/queue/:rendererUdn/repeat', (req, res) => {
  queueManager.setRepeat(req.params.rendererUdn, !!req.body.repeat);
  res.json(queueManager.getState(req.params.rendererUdn));
});

app.post('/api/queue/:rendererUdn/next', async (req, res) => {
  try {
    await queueManager.next(req.params.rendererUdn);
    res.json(queueManager.getState(req.params.rendererUdn));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/queue/:rendererUdn/jump', async (req, res) => {
  try {
    await queueManager.jumpTo(req.params.rendererUdn, req.body.index);
    res.json(queueManager.getState(req.params.rendererUdn));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/queue/:rendererUdn/previous', async (req, res) => {
  try {
    await queueManager.previous(req.params.rendererUdn);
    res.json(queueManager.getState(req.params.rendererUdn));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Full stop: clears the queue entirely so nothing can auto-advance later.
app.post(
  '/api/queue/:rendererUdn/stop',
  requireDevice((req) => registry.getDevice(req.params.rendererUdn)),
  async (req, res) => {
    try {
      await queueManager.stopAndClear(req.params.rendererUdn);
      res.json(queueManager.getState(req.params.rendererUdn));
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.post(
  '/api/queue/:rendererUdn/pause',
  requireDevice((req) => registry.getDevice(req.params.rendererUdn)),
  async (req, res) => {
    try {
      await pause(req.device);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.post(
  '/api/queue/:rendererUdn/resume',
  requireDevice((req) => registry.getDevice(req.params.rendererUdn)),
  async (req, res) => {
    try {
      await play(req.device);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.post(
  '/api/queue/:rendererUdn/seek',
  requireDevice((req) => registry.getDevice(req.params.rendererUdn)),
  async (req, res) => {
    try {
      await seek(req.device, req.body.relTime);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.get(
  '/api/renderers/:udn/volume',
  requireDevice((req) => registry.getDevice(req.params.udn)),
  async (req, res) => {
    try {
      res.json({ volume: await getVolume(req.device), muted: await getMute(req.device) });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.post(
  '/api/renderers/:udn/volume',
  requireDevice((req) => registry.getDevice(req.params.udn)),
  async (req, res) => {
    try {
      const limit = volumeLimits[req.params.udn];
      const volume = limit !== undefined ? Math.min(req.body.volume, limit) : req.body.volume;
      await setVolume(req.device, volume);
      res.json({ ok: true, volume });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

app.get('/api/renderers/:udn/volume-limit', (req, res) => {
  res.json({ maxVolume: volumeLimits[req.params.udn] ?? null });
});

app.post('/api/renderers/:udn/volume-limit', async (req, res) => {
  const { maxVolume } = req.body;
  if (maxVolume === null || maxVolume === undefined) {
    delete volumeLimits[req.params.udn];
  } else {
    volumeLimits[req.params.udn] = Math.max(1, Math.min(100, Math.round(maxVolume)));
  }
  await saveVolumeLimits(volumeLimits);
  res.json({ maxVolume: volumeLimits[req.params.udn] ?? null });
});

app.post(
  '/api/renderers/:udn/mute',
  requireDevice((req) => registry.getDevice(req.params.udn)),
  async (req, res) => {
    try {
      await setMute(req.device, req.body.muted);
      res.json({ ok: true });
    } catch (err) {
      res.status(502).json({ error: err.message });
    }
  }
);

const webDist = path.join(__dirname, '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('*', (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

registry.on('update', (devices) => broadcast({ type: 'devices', payload: devices }));
queueManager.on('state', (state) => {
  broadcast({ type: 'queue-state', payload: state });
  discordPresence.onQueueState(state);
});

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'devices', payload: registry.getDevices() }));
});

async function main() {
  volumeLimits = await loadVolumeLimits();

  // Not awaited: an asleep device shouldn't hold up startup, and it'll
  // appear via the update broadcast once it answers.
  for (const location of await loadPinnedLocations()) {
    registry.addPinned(location, { keepIfOffline: true }).catch((err) => {
      console.warn(`Pinned device ${location} is offline, will retry: ${err.message}`);
    });
  }

  registry.on('pins-changed', (locations) => savePinnedLocations(locations).catch(() => {}));
  await extraDiscovery.start();
  localLibrary.on('update', () => broadcast({ type: 'devices', payload: registry.getDevices() }));
  await localLibrary.start();
  registry.start();
  queueManager.start();
  discordPresence.start();

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(PORT, () => {
      console.log(`nodeDLNA server listening on http://localhost:${PORT}`);
      resolve();
    });
  });
  return PORT;
}

// Awaited by the desktop app so it only opens its window once the server is up.
export const ready = main();
