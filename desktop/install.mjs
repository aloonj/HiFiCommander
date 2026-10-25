// Installs the built desktop app for the current user: app files, launcher
// entry and icon under ~/.local/share, plus a one-time copy of any existing
// pinned devices / volume limits from server/data into the app's config dir.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconPng } from './icon.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = path.join(root, 'dist-desktop', 'linux-unpacked');
const share = process.env.XDG_DATA_HOME ?? path.join(homedir(), '.local', 'share');
const config = process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config');

const appDir = path.join(share, 'hificommander');
const iconDir = path.join(share, 'icons', 'hicolor', '256x256', 'apps');
const desktopFile = path.join(share, 'applications', 'hificommander.desktop');
const dataDir = path.join(config, 'HiFiCommander');

if (!existsSync(built)) {
  console.error('No build found. Run `npm run desktop:build` first.');
  process.exit(1);
}

rmSync(appDir, { recursive: true, force: true });
cpSync(built, appDir, { recursive: true });

mkdirSync(iconDir, { recursive: true });
writeFileSync(path.join(iconDir, 'hificommander.png'), iconPng(256));

mkdirSync(path.dirname(desktopFile), { recursive: true });
writeFileSync(
  desktopFile,
  `[Desktop Entry]
Type=Application
Name=HiFiCommander
Comment=Play your DLNA music library
Exec=${path.join(appDir, 'hificommander')}
Icon=hificommander
Categories=AudioVideo;Audio;Player;
StartupWMClass=HiFiCommander
`
);

const oldData = path.join(root, 'server', 'data');
mkdirSync(dataDir, { recursive: true });
if (existsSync(oldData)) {
  for (const name of readdirSync(oldData).filter((f) => f.endsWith('.json') && !f.endsWith('.example.json'))) {
    const target = path.join(dataDir, name);
    if (!existsSync(target)) {
      cpSync(path.join(oldData, name), target);
      console.log(`Copied ${name} to ${dataDir}`);
    }
  }
}

console.log(`Installed to ${appDir}`);
