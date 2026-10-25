import { deflateSync } from 'node:zlib';

// Rasterises the same equalizer-bar mark as web/public/favicon.svg into a PNG,
// since Electron's tray and .desktop launchers can't use SVG directly.
const SHAPES = [
  { x: 0, y: 0, w: 32, h: 32, r: 8, color: [0x14, 0x14, 0x14] },
  { x: 8, y: 16, w: 3.5, h: 8, r: 1.5, color: [0xc9, 0xa2, 0x27] },
  { x: 14.25, y: 10, w: 3.5, h: 14, r: 1.5, color: [0xc9, 0xa2, 0x27] },
  { x: 20.5, y: 13, w: 3.5, h: 11, r: 1.5, color: [0xc9, 0xa2, 0x27] },
];

// Signed distance from (px, py) to a rounded rect, negative inside.
function roundedRectDistance(px, py, { x, y, w, h, r }) {
  const dx = Math.abs(px - (x + w / 2)) - (w / 2 - r);
  const dy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function rasterise(size) {
  const scale = size / 32;
  const rgba = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const shape of SHAPES) {
        const d = roundedRectDistance((px + 0.5) / scale, (py + 0.5) / scale, shape);
        const coverage = Math.min(1, Math.max(0, 0.5 - d * scale));
        if (coverage === 0) continue;
        const outA = coverage + a * (1 - coverage);
        [r, g, b] = shape.color.map((c, i) => (c * coverage + [r, g, b][i] * a * (1 - coverage)) / outA);
        a = outA;
      }
      rgba.set([r, g, b, a * 255].map(Math.round), (py * size + px) * 4);
    }
  }
  return rgba;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

export function iconPng(size) {
  const rgba = rasterise(size);
  // Each scanline is prefixed with filter type 0 (none).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
