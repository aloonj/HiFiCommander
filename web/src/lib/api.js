async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error ?? `${method} ${url} failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getDevices: () => request('GET', '/api/devices'),
  addPinnedDevice: (location) => request('POST', '/api/devices/pinned', { location }),
  removePinnedDevice: (udn) => request('DELETE', `/api/devices/pinned/${udn}`),

  browse: (serverUdn, objectId) => request('GET', `/api/browse?server=${encodeURIComponent(serverUdn)}&id=${encodeURIComponent(objectId)}`),

  getQueue: (rendererUdn) => request('GET', `/api/queue/${rendererUdn}`),
  playNow: (rendererUdn, tracks, startIndex = 0) => request('POST', `/api/queue/${rendererUdn}/play`, { tracks, startIndex }),
  addToQueue: (rendererUdn, tracks) => request('POST', `/api/queue/${rendererUdn}/add`, { tracks }),
  next: (rendererUdn) => request('POST', `/api/queue/${rendererUdn}/next`),
  previous: (rendererUdn) => request('POST', `/api/queue/${rendererUdn}/previous`),
  jump: (rendererUdn, index) => request('POST', `/api/queue/${rendererUdn}/jump`, { index }),
  stop: (rendererUdn) => request('POST', `/api/queue/${rendererUdn}/stop`),
  pause: (rendererUdn) => request('POST', `/api/queue/${rendererUdn}/pause`),
  resume: (rendererUdn) => request('POST', `/api/queue/${rendererUdn}/resume`),
  seek: (rendererUdn, relTime) => request('POST', `/api/queue/${rendererUdn}/seek`, { relTime }),

  getVolume: (rendererUdn) => request('GET', `/api/renderers/${rendererUdn}/volume`),
  setVolume: (rendererUdn, volume) => request('POST', `/api/renderers/${rendererUdn}/volume`, { volume }),
  setMute: (rendererUdn, muted) => request('POST', `/api/renderers/${rendererUdn}/mute`, { muted }),
  getVolumeLimit: (rendererUdn) => request('GET', `/api/renderers/${rendererUdn}/volume-limit`),
  setVolumeLimit: (rendererUdn, maxVolume) => request('POST', `/api/renderers/${rendererUdn}/volume-limit`, { maxVolume }),
};
