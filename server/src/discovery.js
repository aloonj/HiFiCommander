import dgram from 'node:dgram';
import os from 'node:os';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { Bonjour } from 'bonjour-service';
import { DATA_DIR } from './dataDir.js';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const PROBE_COOLDOWN_MS = 60 * 1000;
const FRESH_MS = 60 * 1000;
const KNOWN_FILE = path.join(DATA_DIR, 'known-devices.json');

// Where common renderers/servers keep their UPnP description, tried against
// hosts that show up on the network but don't answer SSDP searches.
const COMMON_DESCRIPTIONS = [
  ':8080/description.xml', // Marantz/Denon network receivers
  ':60006/upnp/desc/aios_device/aios_device.xml', // Denon/Marantz HEOS
  ':49152/description.xml',
  ':49153/description.xml',
  ':49494/upnp/description.xml', // Gerbera
  ':8200/rootDesc.xml', // MiniDLNA
  ':1400/xml/device_description.xml', // Sonos
  ':80/description.xml',
];

// mDNS service types that network players commonly advertise, even when
// their UPnP side ignores searches.
const MDNS_TYPES = ['airplay', 'raop', 'googlecast', 'spotify-connect', 'http'];

function localAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a.family === 'IPv4' && !a.internal)
    .map((a) => a.address);
}

function parseSsdp(text) {
  const [startLine, ...lines] = text.split('\r\n');
  const headers = {};
  for (const line of lines) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toUpperCase()] = line.slice(i + 1).trim();
  }
  return { startLine, headers };
}

// Fallbacks for devices like the Marantz M-CR611 that never answer SSDP
// M-SEARCH: it can still be spotted via its own SSDP searches, periodic
// NOTIFY announcements or mDNS, then located by probing likely description
// URLs. Devices found once are remembered so a new DHCP address is picked up
// straight away on the next sighting.
export class ExtraDiscovery {
  constructor(registry) {
    this.registry = registry;
    this.known = {}; // udn -> { location, friendlyName }
    this.lastProbe = new Map(); // host -> timestamp
  }

  async start() {
    this.known = await readFile(KNOWN_FILE, 'utf-8').then(JSON.parse).catch(() => ({}));
    this.registry.keepListed = (udn) => udn in this.known;
    // Remembered devices not seen yet this run, so the UI can list them as
    // offline instead of them silently missing.
    this.registry.getMissingKnown = () =>
      Object.entries(this.known)
        .filter(([udn]) => !this.registry.devices.has(udn))
        .map(([udn, k]) => ({ udn, friendlyName: k.friendlyName, kind: k.kind ?? null, address: new URL(k.location).hostname }));
    this.registry.on('found', (entry) => this._remember(entry));
    this.registry.on('search', () => this._onSearch());
    this._startPassiveListener();
    this._startMdns();
  }

  rescan() {
    this.lastProbe.clear();
    for (const browser of this.browsers ?? []) browser.update();
  }

  _onSearch() {
    // Remembered devices that are currently missing (asleep, or not yet
    // seen this run) are checked at their last address each round.
    for (const [udn, { location }] of Object.entries(this.known)) {
      if (!this.registry.devices.has(udn)) this.registry.registerLocation(location, 'remembered').catch(() => {});
    }
    // Unicast searches to hosts we've seen but not identified; some devices
    // only answer those.
    for (const host of this.lastProbe.keys()) {
      if (!this.registry.hasHost(host)) this._sendSearch(host);
    }
  }

  _startPassiveListener() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    this.socket.on('error', (err) => console.warn(`SSDP listener error: ${err.message}`));
    this.socket.on('message', (msg, rinfo) => this._onSsdpMessage(msg.toString(), rinfo));
    this.socket.bind(SSDP_PORT, () => {
      for (const address of localAddresses()) {
        try {
          this.socket.addMembership(SSDP_ADDRESS, address);
        } catch {
          // interface may not support multicast
        }
      }
    });
  }

  _onSsdpMessage(text, rinfo) {
    if (localAddresses().includes(rinfo.address)) return;
    const { startLine, headers } = parseSsdp(text);

    if (startLine.startsWith('M-SEARCH')) {
      this._probeHost(rinfo.address, 'traffic');
    } else if (startLine.startsWith('NOTIFY') && headers.NTS === 'ssdp:alive' && headers.LOCATION) {
      this._register(headers.LOCATION, 'announce');
    } else if (startLine.startsWith('HTTP/1.1 200') && headers.LOCATION) {
      // A reply to a unicast probe, or one meant for node-ssdp's socket that
      // the kernel delivered here instead (both share port 1900).
      this._register(headers.LOCATION, 'ssdp');
    }
  }

  _startMdns() {
    try {
      this.bonjour = new Bonjour();
    } catch (err) {
      console.warn(`mDNS unavailable: ${err.message}`);
      return;
    }
    this.browsers = MDNS_TYPES.map((type) =>
      this.bonjour.find({ type }, (service) => {
        const addresses = [...(service.addresses ?? []), service.referer?.address].filter(
          (a) => a && a.includes('.')
        );
        for (const address of new Set(addresses)) this._probeHost(address, 'mdns');
      })
    );
  }

  _register(location, source) {
    if (this._isFresh(location)) return;
    this.registry.registerLocation(location, source).catch(() => {});
  }

  _isFresh(location) {
    for (const entry of this.registry.devices.values()) {
      if (entry.location === location && Date.now() - entry.lastSeen < FRESH_MS) return true;
    }
    return false;
  }

  _sendSearch(host) {
    const search = Buffer.from(
      `M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDRESS}:${SSDP_PORT}\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ssdp:all\r\n\r\n`
    );
    this.socket?.send(search, SSDP_PORT, host, () => {});
  }

  _probeHost(host, source) {
    if (this.registry.hasHost(host)) return;
    const last = this.lastProbe.get(host);
    if (last && Date.now() - last < PROBE_COOLDOWN_MS) return;
    this.lastProbe.set(host, Date.now());

    this._sendSearch(host);

    // Remembered devices first: same port/path at the new address.
    const candidates = new Set();
    for (const { location } of Object.values(this.known)) {
      const url = new URL(location);
      url.hostname = host;
      candidates.add(url.toString());
    }
    for (const suffix of COMMON_DESCRIPTIONS) candidates.add(`http://${host}${suffix}`);
    for (const location of candidates) {
      this.registry.registerLocation(location, source).catch(() => {});
    }
  }

  forget(udn) {
    const wasKnown = udn in this.known;
    delete this.known[udn];
    if (wasKnown) this._save();
    return this.registry.forget(udn) || wasKnown;
  }

  _remember(entry) {
    const previous = this.known[entry.info.udn];
    if (previous?.location === entry.location) return;
    this.known[entry.info.udn] = {
      location: entry.location,
      friendlyName: entry.info.friendlyName,
      kind: entry.kind,
    };
    this._save();
  }

  _save() {
    writeFile(KNOWN_FILE, JSON.stringify(this.known, null, 2)).catch((err) =>
      console.warn(`Failed to save known devices: ${err.message}`)
    );
  }
}
