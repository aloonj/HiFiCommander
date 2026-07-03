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
  const res = await fetch(location);
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
    // Bind to the standard SSDP port so unicast M-SEARCH replies match the
    // firewall rule that allows inbound UDP/1900 from the LAN.
    this.client = new Client({ sourcePort: 1900 });
    this.client.on('response', (headers) => this._handleResponse(headers));
    // Some devices don't answer M-SEARCH but do broadcast NOTIFY ssdp:alive
    // on their own (e.g. right after waking from a low-power network state) -
    // node-ssdp parses these separately from search responses, so both need
    // wiring up to actually see them.
    this.client.on('advertise-alive', (headers) => this._handleResponse(headers));
    this.client.on('advertise-bye', (headers) => this._handleBye(headers));
  }

  // Some older/quirky devices (e.g. this project's Marantz M-CR611) don't
  // reliably answer SSDP M-SEARCH. Pinning by known description URL bypasses
  // discovery entirely and survives restarts via whatever the caller persists.
  async addPinned(location) {
    const info = await fetchDeviceDescription(location);
    const kind = classify(info);
    if (!kind) throw new Error(`${info.friendlyName ?? location} is not a MediaServer or MediaRenderer`);
    this.devices.set(info.udn, { info, kind, lastSeen: Date.now(), pinned: true, location });
    this.emit('update', this.getDevices());
    return { udn: info.udn, friendlyName: info.friendlyName, kind };
  }

  removePinned(udn) {
    const entry = this.devices.get(udn);
    if (!entry?.pinned) return false;
    this.devices.delete(udn);
    this.emit('update', this.getDevices());
    return true;
  }

  getPinnedLocations() {
    return [...this.devices.values()].filter((e) => e.pinned).map((e) => e.location);
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

  _search() {
    this.client.search(MEDIA_SERVER_TYPE);
    this.client.search(MEDIA_RENDERER_TYPE);
  }

  async _handleResponse(headers) {
    const location = headers.LOCATION;
    if (!location) return;

    try {
      const info = await fetchDeviceDescription(location);
      const kind = classify(info);
      if (!kind) return;

      const existing = this.devices.get(info.udn);
      this.devices.set(info.udn, { info, kind, lastSeen: Date.now(), pinned: existing?.pinned ?? false, location });
      if (!existing) {
        this.emit('update', this.getDevices());
      }
    } catch {
      // ignore devices we can't fetch/parse
    }
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
    for (const [udn, entry] of this.devices) {
      if (!entry.pinned && now - entry.lastSeen > STALE_MS) {
        this.devices.delete(udn);
        changed = true;
      }
    }
    if (changed) this.emit('update', this.getDevices());
  }

  getDevices() {
    const servers = [];
    const renderers = [];
    for (const { info, kind, pinned } of this.devices.values()) {
      const summary = {
        udn: info.udn,
        friendlyName: info.friendlyName,
        manufacturer: info.manufacturer,
        modelName: info.modelName,
        pinned,
      };
      if (kind === 'server') servers.push(summary);
      else renderers.push(summary);
    }
    return { servers, renderers };
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
