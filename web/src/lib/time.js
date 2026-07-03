// DLNA reports durations/positions as "H:MM:SS" or "H:MM:SS.mmm" strings.
export function parseDuration(value) {
  if (!value) return 0;
  const [h, m, s] = value.split(':');
  return Number(h) * 3600 + Number(m) * 60 + parseFloat(s);
}

export function formatSeconds(totalSeconds) {
  const total = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function secondsToRelTime(totalSeconds) {
  const total = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
