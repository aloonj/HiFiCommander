import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseFile } from 'music-metadata';
import { DATA_DIR } from './dataDir.js';

export const LOCAL_LIBRARY_UDN = 'local-library';

const CONFIG_FILE = path.join(DATA_DIR, 'library.json');
const INDEX_FILE = path.join(DATA_DIR, 'library-index.json');
const COVER_NAMES = ['cover', 'folder', 'front', 'album'];

const MIME = {
  '.flac': 'audio/flac',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aif': 'audio/aiff',
  '.aiff': 'audio/aiff',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.dsf': 'audio/dsf',
  '.dff': 'audio/dff',
};

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const byTitle = (a, b) => (a.title ?? '').localeCompare(b.title ?? '', undefined, { sensitivity: 'base' });

function relTime(seconds) {
  if (!seconds) return undefined;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = (seconds % 60).toFixed(3).padStart(6, '0');
  return `${h}:${String(m).padStart(2, '0')}:${s}`;
}

// Address renderers on the LAN can reach this machine at; localhost would
// only work for playback inside this computer.
function lanAddress() {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((a) => a.family === 'IPv4' && !a.internal);
  return (addresses.find((a) => /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address)) ?? addresses[0])?.address ?? '127.0.0.1';
}

// A library of music folders on this computer, served to the UI in the same
// shape as a DLNA ContentDirectory browse so BrowsePane needs no changes,
// and streamed over HTTP so DLNA renderers can play the files too.
export class LocalLibrary extends EventEmitter {
  constructor(port) {
    super();
    this.port = port;
    this.folders = [];
    this.tracks = new Map(); // id -> track
    this.status = { scanning: false, scanned: 0 };
  }

  async start() {
    const config = await readFile(CONFIG_FILE, 'utf-8').then(JSON.parse).catch(() => ({}));
    this.folders = config.folders ?? [];
    const cached = await readFile(INDEX_FILE, 'utf-8').then(JSON.parse).catch(() => []);
    for (const track of cached) this.tracks.set(track.id, track);
    this.rescan();
  }

  summary() {
    return {
      udn: LOCAL_LIBRARY_UDN,
      friendlyName: 'Local Music',
      online: true,
      local: true,
      folders: this.folders,
      ...this.status,
      trackCount: this.tracks.size,
    };
  }

  async setFolders(folders) {
    const valid = [];
    for (const folder of folders) {
      const info = await stat(folder).catch(() => null);
      if (!info?.isDirectory()) throw new Error(`Not a folder: ${folder}`);
      valid.push(path.resolve(folder));
    }
    this.folders = [...new Set(valid)];
    await writeFile(CONFIG_FILE, JSON.stringify({ folders: this.folders }, null, 2));
    this.rescan();
  }

  // Re-reads tags only for files whose size or mtime changed since the last
  // scan, so a rescan of an unchanged library is quick.
  async rescan() {
    if (this.status.scanning) return;
    this.status = { scanning: true, scanned: 0 };
    this.emit('update');

    const previous = new Map([...this.tracks.values()].map((t) => [t.path, t]));
    const next = new Map();
    const files = [];
    for (const folder of this.folders) await this._walk(folder, folder, files);

    for (const { file, root } of files) {
      const info = await stat(file).catch(() => null);
      if (!info) continue;
      const old = previous.get(file);
      const track =
        old && old.size === info.size && old.mtimeMs === info.mtimeMs ? old : await this._read(file, root, info);
      if (track) next.set(track.id, track);
      this.status.scanned++;
      if (this.status.scanned % 50 === 0) this.emit('update');
    }

    this.tracks = next;
    this.status = { scanning: false, scanned: next.size };
    await writeFile(INDEX_FILE, JSON.stringify([...next.values()])).catch(() => {});
    this.emit('update');
  }

  async _walk(dir, root, out) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await this._walk(full, root, out);
      else if (MIME[path.extname(entry.name).toLowerCase()]) out.push({ file: full, root });
    }
  }

  async _read(file, root, info) {
    try {
      const { format, common } = await parseFile(file, { duration: true, skipCovers: true });
      const ext = path.extname(file).toLowerCase();
      const album = common.album ?? path.basename(path.dirname(file));
      const albumArtist = common.albumartist ?? common.artist ?? 'Unknown artist';
      return {
        id: hash(file),
        path: file,
        root,
        dir: path.dirname(file),
        size: info.size,
        mtimeMs: info.mtimeMs,
        ext,
        title: common.title ?? path.basename(file, ext),
        artist: common.artist ?? albumArtist,
        albumArtist,
        album,
        albumKey: hash(`${albumArtist}\u0000${album}`),
        disk: common.disk?.no ?? 1,
        trackNo: common.track?.no ?? 0,
        duration: format.duration,
        sampleRate: format.sampleRate,
        bitsPerSample: format.bitsPerSample,
        channels: format.numberOfChannels,
        bitrate: format.bitrate,
        codec: format.codec,
        lossless: format.lossless,
      };
    } catch {
      return null;
    }
  }

  _base() {
    return `http://${lanAddress()}:${this.port}/api/local`;
  }

  _trackItem(t) {
    const mime = MIME[t.ext];
    return {
      type: 'track',
      id: `t:${t.id}`,
      title: t.title,
      artist: t.artist,
      album: t.album,
      trackNumber: t.trackNo || undefined,
      albumArtURI: `${this._base()}/art/track/${t.id}`,
      res: {
        uri: `${this._base()}/stream/${t.id}${t.ext}`,
        protocolInfo: `http-get:*:${mime}:DLNA.ORG_OP=01;DLNA.ORG_FLAGS=01700000000000000000000000000000`,
        duration: relTime(t.duration),
        size: t.size,
        sampleRate: t.sampleRate,
        bitsPerSample: t.bitsPerSample,
        channels: t.channels,
        bitrate: t.bitrate,
        // m4a covers both AAC and ALAC, so pass the real codec along.
        codec: t.codec,
      },
    };
  }

  _albums(tracks) {
    const albums = new Map();
    for (const t of tracks) {
      const a = albums.get(t.albumKey) ?? { key: t.albumKey, title: t.album, artist: t.albumArtist, count: 0 };
      a.count++;
      albums.set(t.albumKey, a);
    }
    return [...albums.values()].sort(byTitle).map((a) => ({
      type: 'container',
      id: `album:${a.key}`,
      title: a.title,
      artist: a.artist,
      childCount: a.count,
      albumArtURI: `${this._base()}/art/${a.key}`,
    }));
  }

  browse(id) {
    const all = [...this.tracks.values()];
    if (id === '0') {
      if (this.folders.length === 0) return [];
      return [
        { type: 'container', id: 'albums', title: 'Albums', childCount: new Set(all.map((t) => t.albumKey)).size },
        { type: 'container', id: 'artists', title: 'Artists', childCount: new Set(all.map((t) => t.albumArtist)).size },
        { type: 'container', id: 'folders', title: 'Folders', childCount: this.folders.length },
      ];
    }
    if (id === 'albums') return this._albums(all);
    if (id === 'artists') {
      const counts = new Map();
      for (const t of all) counts.set(t.albumArtist, (counts.get(t.albumArtist) ?? 0) + 1);
      return [...counts]
        .map(([name, count]) => ({ type: 'container', id: `artist:${name}`, title: name, childCount: count }))
        .sort(byTitle);
    }
    if (id.startsWith('artist:')) {
      const name = id.slice('artist:'.length);
      return this._albums(all.filter((t) => t.albumArtist === name));
    }
    if (id.startsWith('album:')) {
      const key = id.slice('album:'.length);
      return all
        .filter((t) => t.albumKey === key)
        .sort((a, b) => a.disk - b.disk || a.trackNo - b.trackNo || byTitle(a, b))
        .map((t) => this._trackItem(t));
    }
    if (id === 'folders') {
      return this.folders.map((f) => ({ type: 'container', id: `dir:${f}`, title: path.basename(f) || f }));
    }
    if (id.startsWith('dir:')) {
      const dir = id.slice('dir:'.length);
      const subdirs = new Map();
      const here = [];
      for (const t of all) {
        if (t.dir === dir) here.push(t);
        else if (t.dir.startsWith(dir + path.sep)) {
          const child = path.join(dir, t.dir.slice(dir.length + 1).split(path.sep)[0]);
          subdirs.set(child, (subdirs.get(child) ?? 0) + 1);
        }
      }
      return [
        ...[...subdirs]
          .map(([d, count]) => ({ type: 'container', id: `dir:${d}`, title: path.basename(d), childCount: count }))
          .sort(byTitle),
        ...here.sort((a, b) => a.trackNo - b.trackNo || byTitle(a, b)).map((t) => this._trackItem(t)),
      ];
    }
    return [];
  }

  trackFile(id) {
    const track = this.tracks.get(id);
    return track ? { path: track.path, mime: MIME[track.ext] } : null;
  }

  // Cover for an album: a cover/folder image in its folder, else whatever
  // its first track has.
  async albumArt(albumKey) {
    const track = [...this.tracks.values()].find((t) => t.albumKey === albumKey);
    if (!track) return null;
    const entries = await readdir(track.dir).catch(() => []);
    for (const name of COVER_NAMES) {
      const match = entries.find((e) => new RegExp(`^${name}\\.(jpe?g|png)$`, 'i').test(e));
      if (match) return { file: path.join(track.dir, match) };
    }
    return this._ownArt(track, entries);
  }

  // Art for one track: an image named after it (e.g. "Song.jpg" or
  // "Song-thumb.jpg", as downloaders save them), its embedded picture, or
  // the album cover.
  async trackArt(id) {
    const track = this.tracks.get(id);
    if (!track) return null;
    const entries = await readdir(track.dir).catch(() => []);
    return (await this._ownArt(track, entries)) ?? this.albumArt(track.albumKey);
  }

  async _ownArt(track, entries) {
    const base = path.basename(track.path, track.ext);
    const sibling = entries.find((e) => [`${base}.jpg`, `${base}.jpeg`, `${base}.png`, `${base}-thumb.jpg`].includes(e));
    if (sibling) return { file: path.join(track.dir, sibling) };
    const { common } = await parseFile(track.path).catch(() => ({ common: {} }));
    const picture = common.picture?.[0];
    return picture ? { data: Buffer.from(picture.data), mime: picture.format } : null;
  }
}
