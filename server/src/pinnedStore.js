import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';

const FILE_PATH = path.join(DATA_DIR, 'pinned-devices.json');

export async function loadPinnedLocations() {
  try {
    const text = await readFile(FILE_PATH, 'utf-8');
    return JSON.parse(text);
  } catch {
    return [];
  }
}

export async function savePinnedLocations(locations) {
  await writeFile(FILE_PATH, JSON.stringify(locations, null, 2));
}
