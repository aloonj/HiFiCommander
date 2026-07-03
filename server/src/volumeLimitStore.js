import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'volume-limits.json');

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
