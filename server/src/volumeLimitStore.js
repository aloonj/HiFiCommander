import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from './dataDir.js';

const FILE_PATH = path.join(DATA_DIR, 'volume-limits.json');

export async function loadVolumeLimits() {
  try {
    const text = await readFile(FILE_PATH, 'utf-8');
    return JSON.parse(text);
  } catch {
    return {};
  }
}

export async function saveVolumeLimits(limits) {
  await writeFile(FILE_PATH, JSON.stringify(limits, null, 2));
}
