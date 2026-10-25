import ssdp from 'node-ssdp';
const { Client } = ssdp;
import { XMLParser } from 'fast-xml-parser';
import { EventEmitter } from 'node:events';

const MEDIA_SERVER_TYPE = 'urn:schemas-upnp-org:device:MediaServer:1';
const MEDIA_RENDERER_TYPE = 'urn:schemas-upnp-org:device:MediaRenderer:1';
const STALE_MS = 5 * 60 * 1000;
const SEARCH_INTERVAL_MS = 30 * 1000;

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

async function fetchDeviceDescription(location) {
  let res;
  try {
    res = await fetch(location, { signal: AbortSignal.timeout(5000) });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? 'timed out' : err.cause?.code ?? err.message;
    throw new Error(`Couldn't reach ${new URL(location).host} (${reason})`, { cause: err.cause ?? err });
  }
  if (!res.ok) throw new Error(`Failed to fetch device description: ${res.status}`);
  const xml = await res.text();
  const parsed = parser.parse(xml);
  const root = parsed.root;
  if (!root?.device) throw new Error('Invalid device description XML');

  const locationUrl = new URL(location);
  const urlBase = root.URLBase ? new URL(root.URLBase) : locationUrl;

  const device = root.device;
  const services = asArray(device.serviceList?.service).map((svc) => ({
    serviceType: svc.serviceType,
    serviceId: svc.serviceId,
    controlURL: new URL(svc.controlURL, urlBase).toString(),
    eventSubURL: new URL(svc.eventSubURL, urlBase).toString(),
    scpdURL: new URL(svc.SCPDURL, urlBase).toString(),
  }));

  return {
    udn: device.UDN,
    deviceType: device.deviceType,
    friendlyName: device.friendlyName,
    manufacturer: device.manufacturer,
    modelName: device.modelName,
    location,
    services,
  };
}

function findService(device, serviceType) {
  return device.services.find((s) => s.serviceType.startsWith(serviceType));
}

function classify(info) {
  if (info.deviceType === MEDIA_SERVER_TYPE && findService(info, 'urn:schemas-upnp-org:service:ContentDirectory')) {
    return 'server';
  }
  if (info.deviceType === MEDIA_RENDERER_TYPE && findService(info, 'urn:schemas-upnp-org:service:AVTransport')) {
    return 'renderer';
  }
  return null;
}

export class DeviceRegistry extends EventEmitter {
  constructor() {
    super();
    this.devices = new Map(); // udn -> { info, lastSeen, kind, pinned, location }
    // Kept separately from devices so a pinned device that's switched off
    // stays pinned (and saved) and gets retried, rather than being forgotten.
    this.pinned = new Map(); // location -> { udn, error }
    this.scan = { scanning: false, lastScanAt: null };
    this._createClient();
  }

  // Bind to the standard SSDP port so unicast M-SEARCH replies match the
  // firewall rule that allows inbound UDP/1900 from the LAN.
  _createClient() {
    this.client = new Client({ sourcePort: 1900 });
    this.client.on('response', (headers) => this._handleResponse(headers, 'ssdp'));
    // Some devices don't answer M-SEARCH but do broadcast NOTIFY ssdp:alive
    // on their own (e.g. right after waking from a low-power network state) -
    // node-ssdp parses these separately from search responses, so both need
    // wiring up to actually see them.
    this.client.on('advertise-alive', (headers) => this._handleResponse(headers, 'announce'));
    this.client.on('advertise-bye', (headers) => this._handleBye(headers));
  }

  // Under Docker host networking, the container can start SSDP discovery
  // before the host's real NIC is up (e.g. right at boot), so the client's
  // first bind attempt sees zero usable interfaces and throws "No sockets
  // available". node-ssdp doesn't recover from that on its own: it silently
  // marks itself "started" with an empty socket map afterwards, so it never
  // tries binding again even once the interface comes up. Detect that stuck
  // state and recreate the client from scratch so discovery can succeed once
  // the network is actually ready.
  _ensureClientReady() {
    const stuck = this.client._started && Object.keys(this.client.sockets ?? {}).length === 0;
    if (!stuck) return;
    this.client.stop();
    this._createClient();
  }

  // Some older/quirky devices (e.g. this project's Marantz M-CR611) don't
  // reliably answer SSDP M-SEARCH. Pinning by known description URL bypasses
  // discovery entirely and survives restarts via whatever the caller persists.
  // Pins a description URL. With keepIfOffline (used when loading saved pins)
  // an unreachable device stays pinned for later retries; otherwise a failed
  // fetch is treated as a bad URL and nothing is pinned.
  async addPinned(location, { keepIfOffline = false } = {}) {
    const isNew = !this.pinned.has(location);
    if (isNew) this.pinned.set(location, { udn: null, error: null });
    try {
      return await this._refreshPinned(location);
    } catch (err) {
      if (!keepIfOffline && isNew) this.pinned.delete(location);
      this.emit('update', this.getDevices());
      throw err;
    }
  }

  async _refreshPinned(location) {
    const entry = this.pinned.get(location);
    try {
      const info = await fetchDeviceDescription(location);
      const kind = classify(info);
      if (!kind) throw new Error(`${info.friendlyName ?? location} is not a MediaServer or MediaRenderer`);
      if (!this.pinned.has(location)) return null; // removed while fetching
      const changed = entry.udn !== info.udn || entry.error !== null || !this.devices.has(info.udn);
      entry.udn = info.udn;
      entry.error = null;
      const source = this.devices.get(info.udn)?.source ?? 'manual';
      this.devices.set(info.udn, { info, kind, lastSeen: Date.now(), pinned: true, location, source });
      if (changed) this.emit('update', this.getDevices());
      return { udn: info.udn, friendlyName: info.friendlyName, kind };
    } catch (err) {
      // A device that was seen before stays listed so its queue survives a
      // nap; it's just reported offline until it answers again.
      const error = err.message;
      if (entry.error !== error) {
        entry.error = error;
        this.emit('update', this.getDevices());
      }
      throw err;
    }
  }

  removePinned(location) {
    const entry = this.pinned.get(location);
    if (!entry) return false;
    this.pinned.delete(location);
    // Left listed as unpinned: if SSDP also finds it, it simply stays;
    // otherwise the normal stale pruning removes it.
    const device = entry.udn ? this.devices.get(entry.udn) : null;
    if (device?.location === location) device.pinned = false;
    this.emit('update', this.getDevices());
    return true;
  }

  getPinnedLocations() {
    return [...this.pinned.keys()];
  }

  _refreshAllPinned() {
    for (const location of this.pinned.keys()) this._refreshPinned(location).catch(() => {});
  }

  start() {
    this._search();
    this._searchTimer = setInterval(() => this._search(), SEARCH_INTERVAL_MS);
    this._staleTimer = setInterval(() => this._pruneStale(), SEARCH_INTERVAL_MS);
  }

  stop() {
    clearInterval(this._searchTimer);
    clearInterval(this._staleTimer);
    this.client.stop();
  }

  // Triggers an immediate search round; "scanning" covers the window in
  // which replies (MX: 3) and probes are still arriving.
  rescan() {
    clearInterval(this._searchTimer);
    this._search();
    this._searchTimer = setInterval(() => this._search(), SEARCH_INTERVAL_MS);
  }

  _search() {
    this.scan = { scanning: true, lastScanAt: Date.now() };
    this.emit('update', this.getDevices());
    this.emit('search');
    clearTimeout(this._scanDoneTimer);
    this._scanDoneTimer = setTimeout(() => {
      this.scan = { ...this.scan, scanning: false };
      this.emit('update', this.getDevices());
    }, 5000);
    this._ensureClientReady();
    this._refreshAllPinned();
    // search() returns a promise only while the client hasn't started yet
    // (the first bind attempt); swallow rejection here so a still-not-ready
    // network doesn't spam unhandled-rejection warnings, and just wait for
    // the next tick's _ensureClientReady() to retry.
    Promise.resolve(this.client.search(MEDIA_SERVER_TYPE)).catch(() => {});
    Promise.resolve(this.client.search(MEDIA_RENDERER_TYPE)).catch(() => {});
  }

  async _handleResponse(headers, source) {
    const location = headers.LOCATION;
    if (!location) return;
    await this.registerLocation(location, source).catch(() => {
      // ignore devices we can't fetch/parse
    });
  }

  // Common entry point for every discovery method: fetches the description
  // and adds or refreshes the device. Resolves to the entry, or null when the
  // URL is a UPnP device but not a media server/renderer.
  async registerLocation(location, source) {
    const info = await fetchDeviceDescription(location);
    const kind = classify(info);
    if (!kind) return null;

    const existing = this.devices.get(info.udn);
    const entry = {
      info,
      kind,
      lastSeen: Date.now(),
      pinned: existing?.pinned ?? false,
      location,
      // Keep how it was first found; a moved device reports its new route.
      source: existing && existing.location === location ? existing.source : source,
    };
    this.devices.set(info.udn, entry);
    if (!existing || existing.location !== location) {
      this._movePinsTo(info.udn, location);
      this.emit('found', entry);
      this.emit('update', this.getDevices());
    } else if (existing.offline) {
      this.emit('update', this.getDevices());
    }
    return entry;
  }

  // A pinned device that turns up at a new address (e.g. DHCP gave it a new
  // IP) has its pin moved along with it, rather than left pointing at nothing.
  _movePinsTo(udn, location) {
    let moved = false;
    for (const [oldLocation, pin] of [...this.pinned]) {
      if (pin.udn !== udn || oldLocation === location) continue;
      this.pinned.delete(oldLocation);
      if (!this.pinned.has(location)) this.pinned.set(location, { udn, error: null });
      moved = true;
    }
    if (moved) {
      const device = this.devices.get(udn);
      if (device) device.pinned = true;
      this.emit('pins-changed', this.getPinnedLocations());
    }
  }

  _setOffline(entry, offline) {
    if (!!entry.offline === offline) return;
    entry.offline = offline;
    this.emit('update', this.getDevices());
  }

  forget(udn) {
    let removed = this.devices.delete(udn);
    for (const [location, pin] of [...this.pinned]) {
      if (pin.udn !== udn) continue;
      this.pinned.delete(location);
      removed = true;
      this.emit('pins-changed', this.getPinnedLocations());
    }
    if (removed) this.emit('update', this.getDevices());
    return removed;
  }

  hasHost(host) {
    for (const { location } of this.devices.values()) {
      if (new URL(location).hostname === host) return true;
    }
    return false;
  }

  _handleBye(headers) {
    const usn = headers.USN;
    if (!usn) return;
    const udn = usn.split('::')[0];
    const entry = this.devices.get(udn);
    if (!entry || entry.pinned) return;
    this.devices.delete(udn);
    this.emit('update', this.getDevices());
  }

  _pruneStale() {
    const now = Date.now();
    let changed = false;
    // Devices found by probing or mDNS never send SSDP replies to refresh
    // lastSeen, so check on quiet ones directly before they'd go stale.
    for (const entry of this.devices.values()) {
      if (entry.pinned || now - entry.lastSeen < SEARCH_INTERVAL_MS * 2) continue;
      fetchDeviceDescription(entry.location)
        .then(() => {
          entry.lastSeen = Date.now();
          this._setOffline(entry, false);
        })
        .catch(() => this._setOffline(entry, true));
    }
    for (const [udn, entry] of this.devices) {
      // Remembered devices stay listed (as offline) so a stereo in standby
      // doesn't vanish from the picker; they're removed only via forget().
      if (!entry.pinned && !this.keepListed?.(udn) && now - entry.lastSeen > STALE_MS) {
        this.devices.delete(udn);
        changed = true;
      }
    }
    if (changed) this.emit('update', this.getDevices());
  }

  getDevices() {
    const servers = [];
    const renderers = [];
    const offlinePins = new Set([...this.pinned.values()].filter((p) => p.error).map((p) => p.udn));
    for (const { info, kind, pinned, location, source, offline } of this.devices.values()) {
      const summary = {
        udn: info.udn,
        friendlyName: info.friendlyName,
        manufacturer: info.manufacturer,
        modelName: info.modelName,
        pinned,
        address: new URL(location).hostname,
        source,
        online: !offline && !offlinePins.has(info.udn),
      };
      if (kind === 'server') servers.push(summary);
      else renderers.push(summary);
    }
    const pinned = [...this.pinned].map(([location, { udn, error }]) => {
      const device = udn ? this.devices.get(udn) : null;
      return {
        location,
        udn,
        friendlyName: device?.info.friendlyName ?? null,
        kind: device?.kind ?? null,
        online: !!device && error === null,
        error,
      };
    });
    return { servers, renderers, pinned, missing: this.getMissingKnown?.() ?? [], scan: this.scan };
  }

  getDevice(udn) {
    return this.devices.get(udn)?.info ?? null;
  }

  getService(udn, serviceType) {
    const device = this.getDevice(udn);
    if (!device) return null;
    return findService(device, serviceType) ?? null;
  }
}
