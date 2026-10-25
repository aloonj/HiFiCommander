import { codecOf } from '@/lib/audioFormat';
import { LOCAL_RENDERER_UDN } from '@/lib/localRenderer';

function khz(rate) {
  return `${+(rate / 1000).toFixed(1)} kHz`;
}

// ALSA sample format name -> bits carried per sample.
function alsaBits(format) {
  const m = format?.match(/^[SU](\d+)/);
  if (m) return Number(m[1]);
  if (/^FLOAT64/.test(format ?? '')) return 64;
  if (/^FLOAT/.test(format ?? '')) return 32;
  return null;
}

// One word for how faithfully the current track reaches the listener, plus
// a sentence explaining it. Null when there's nothing useful to say.
//   signal: what a local DAC is actually running at ({ rate, format }),
//   browserRate: the browser's audio output rate, for the local player.
export function describeSignal({ rendererUdn, rendererName, res, signal, browserRate }) {
  const codec = codecOf(res);
  if (!codec || !rendererUdn) return null;
  const source = res.sampleRate ? `${res.bitsPerSample ? `${res.bitsPerSample}-bit/` : ''}${khz(res.sampleRate)}` : null;

  if (rendererUdn.startsWith('hires:')) {
    if (!signal) return null; // device not open yet
    if (res.sampleRate && signal.rate !== res.sampleRate) {
      return {
        label: 'resampled',
        detail: `The DAC is running at ${khz(signal.rate)} but the file is ${khz(res.sampleRate)}, so it's being converted. The DAC may not support this rate.`,
      };
    }
    if (!codec.lossless) {
      return {
        label: 'direct',
        detail: `Sent unaltered to ${rendererName} at ${khz(signal.rate)}, but the file itself is lossy (${codec.name}).`,
      };
    }
    const bits = alsaBits(signal.format);
    if (res.bitsPerSample && bits && bits < res.bitsPerSample) {
      return {
        label: 'truncated',
        detail: `The DAC is taking ${bits}-bit samples but the file is ${res.bitsPerSample}-bit, so some detail is lost.`,
      };
    }
    return {
      label: 'bit-perfect',
      detail: `Sent unaltered to ${rendererName} at ${source ?? khz(signal.rate)}, with nothing else mixed in.`,
    };
  }

  if (rendererUdn === LOCAL_RENDERER_UDN) {
    const resampled = browserRate && res.sampleRate && browserRate !== res.sampleRate;
    return {
      label: 'not bit-perfect',
      detail: resampled
        ? `Played through this computer's normal audio, which runs at ${khz(browserRate)}, so this ${khz(res.sampleRate)} file is resampled. Choose a DAC player for bit-perfect playback.`
        : "Played through this computer's normal audio, where the browser and system mixer process the sound. Choose a DAC player for bit-perfect playback.",
    };
  }

  // UPnP renderer: it fetches and decodes the original file itself.
  if (!codec.lossless) return null;
  return {
    label: 'lossless',
    detail: `The original ${codec.name} file is sent to ${rendererName}, which decodes it itself. What happens inside the device can't be checked from here; flat tone settings help keep it untouched.`,
  };
}
