import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The desktop app points this at its per-user config dir, since the packaged
// app's own directory isn't writable. Standalone runs keep using server/data.
export const DATA_DIR =
  process.env.HIFI_DATA_DIR ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

mkdirSync(DATA_DIR, { recursive: true });
