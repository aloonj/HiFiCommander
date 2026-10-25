import { app, BrowserWindow, Menu, Tray, dialog, nativeImage, shell } from 'electron';
import { iconPng } from './icon.mjs';

// Only one copy can own SSDP's UDP 1900, so a second launch just raises the
// existing window instead of starting another server.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(start);
}

let win = null;
let tray = null;
let quitting = false;
let port = null;

const icon = nativeImage.createFromBuffer(iconPng(256));

async function start() {
  process.env.HIFI_DATA_DIR ??= app.getPath('userData');
  try {
    const server = await import('../server/src/index.js');
    port = await server.ready;
  } catch (err) {
    dialog.showErrorBox(
      'HiFiCommander could not start',
      err.code === 'EADDRINUSE'
        ? `Port ${err.port} is already in use. Is a dev server still running?`
        : err.message
    );
    app.exit(1);
    return;
  }

  createTray();
  showWindow();
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    // Below this the layout drops to its stacked phone form, which doesn't
    // suit a desktop window; the web UI still handles small screens.
    minWidth: 820,
    minHeight: 540,
    title: 'HiFiCommander',
    icon,
    autoHideMenuBar: true,
    backgroundColor: '#141414',
  });
  win.loadURL(`http://localhost:${port}`);

  // Links out of the app (e.g. album art sources) open in the real browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Closing hides to the tray so playback and the queue keep going.
  win.on('close', (event) => {
    if (quitting || !tray) return;
    event.preventDefault();
    win.hide();
  });
  win.on('closed', () => {
    win = null;
  });
}

function showWindow() {
  if (!port) return;
  if (!win) createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromBuffer(iconPng(64)));
  tray.setToolTip('HiFiCommander');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open HiFiCommander', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ])
  );
  tray.on('click', showWindow);
}

app.on('before-quit', () => {
  quitting = true;
});

// The tray keeps the app alive with no windows open; Quit is the only exit.
app.on('window-all-closed', () => {});
