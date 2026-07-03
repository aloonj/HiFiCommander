import express from 'express';
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { DeviceRegistry } from './ssdp.js';
import { QueueManager } from './queueManager.js';
import { browse } from './contentDirectory.js';
import { pause, play, seek } from './avTransport.js';
import { getVolume, setVolume, getMute, setMute } from './renderingControl.js';
import { loadPinnedLocations, savePinnedLocations } from './pinnedStore.js';
import { loadVolumeLimits, saveVolumeLimits } from './volumeLimitStore.js';

const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const registry = new DeviceRegistry();
const queueManager = new QueueManager(registry);
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

app.post('/api/devices/pinned', async (req, res) => {
  try {
    const info = await registry.addPinned(req.body.location);
    await savePinnedLocations(registry.getPinnedLocations());
    res.json(info);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/devices/pinned/:udn', async (req, res) => {
  const removed = registry.removePinned(req.params.udn);
  if (!removed) return res.status(404).json({ error: 'Pinned device not found' });
  await savePinnedLocations(registry.getPinnedLocations());
  res.json({ ok: true });
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
queueManager.on('state', (state) => broadcast({ type: 'queue-state', payload: state }));

wss.on('connection', (socket) => {
  socket.send(JSON.stringify({ type: 'devices', payload: registry.getDevices() }));
});

async function main() {
  volumeLimits = await loadVolumeLimits();

  const pinnedLocations = await loadPinnedLocations();
  for (const location of pinnedLocations) {
    try {
      await registry.addPinned(location);
    } catch (err) {
      console.warn(`Failed to load pinned device ${location}: ${err.message}`);
    }
  }

  registry.start();
  queueManager.start();

  httpServer.listen(PORT, () => {
    console.log(`nodeDLNA server listening on http://localhost:${PORT}`);
  });
}

main();
