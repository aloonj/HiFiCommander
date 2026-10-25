const CODECS = [
  [/flac/, 'FLAC', true],
  [/wav|wave|l16|lpcm/, 'WAV', true],
  [/aiff/, 'AIFF', true],
  [/dsd|dsf|dff/, 'DSD', true],
  [/alac/, 'ALAC', true],
  [/mpeg|mp3/, 'MP3', false],
  [/mp4|m4a|aac/, 'AAC', false],
  [/ogg|vorbis/, 'OGG', false],
  [/opus/, 'Opus', false],
];

// Codec name and whether it's lossless, from the res mime type
// (protocolInfo's third field) or an explicit codec hint.
export function codecOf(res) {
  const mime = (res?.codec ?? res?.protocolInfo?.split(':')[2] ?? '').toLowerCase();
  for (const [pattern, name, lossless] of CODECS) {
    if (pattern.test(mime)) return { name, lossless };
  }
  return null;
}

function khz(rate) {
  const k = rate / 1000;
  return Number.isInteger(k) ? String(k) : k.toFixed(1);
}

// Short label like "FLAC 24/96" for lossless or "MP3 320k" for lossy.
export function formatLabel(res) {
  const codec = codecOf(res);
  if (!codec) return null;
  if (codec.lossless && res.sampleRate) {
    return res.bitsPerSample
      ? `${codec.name} ${res.bitsPerSample}/${khz(res.sampleRate)}`
      : `${codec.name} ${khz(res.sampleRate)}kHz`;
  }
  if (!codec.lossless && res.bitrate) return `${codec.name} ${Math.round(res.bitrate / 1000)}k`;
  return codec.name;
}

// Hi-res: more than CD's 16-bit/44.1kHz.
export function isHiRes(res) {
  return codecOf(res)?.lossless && ((res.bitsPerSample ?? 0) > 16 || (res.sampleRate ?? 0) > 48000);
}
