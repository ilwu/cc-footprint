'use strict';

// ── System tray (Windows) / menu bar icon (macOS) ────────────────────
// One switch per item, a status line on top, Exit at the bottom. There is
// no tray on Linux: the items are chosen by editing config.json.

const childProcess = require('child_process');
const fs = require('fs');
const path = require('path');

function fmtMem(bytes) {
  const mb = bytes / 1048576;
  return mb >= 1024 ? (mb / 1024).toFixed(1) + 'GB' : Math.round(mb) + 'MB';
}

// The program that draws the icon ships inside systray2 as
// tray_windows_release.exe (tray_darwin_release on macOS), and with no
// version resource that file name is what Task Manager, Activity Monitor
// and the taskbar's icon settings show. It is run from a copy named after
// this tool.
const TRAY_HELPER = {
  win32: { shipped: /^tray_windows/, own: 'cc-footprint.exe' },
  darwin: { shipped: /^tray_darwin/, own: 'cc-footprint' },
}[process.platform];

// Returns null when the copy cannot be made
function ownTrayHelper(shipped, configDir) {
  const own = path.join(configDir, TRAY_HELPER.own);
  try {
    const from = fs.statSync(shipped);
    let to = null;
    try { to = fs.statSync(own); } catch {}
    // A copy in use by a tray still running cannot be replaced, nor need be
    if (!to || to.size !== from.size || to.mtimeMs < from.mtimeMs) {
      fs.copyFileSync(shipped, own);
      if (process.platform !== 'win32') fs.chmodSync(own, 0o755);
    }
    return own;
  } catch {
    return null;
  }
}

// config: see config.js; m: the monitor's state (store); sessions: see
// sessions.js; onExit: what Exit does after closing the icon.
function createTray({ config, m, sessions, configDir, onExit }) {
  let systray = null;

  const statusItem = { title: 'Collecting...', tooltip: 'Collecting...', checked: false, enabled: false };
  const toggleItems = config.items.map(item => ({
    title: item.label,
    tooltip: `Toggle ${item.label}`,
    checked: !!config.values[item.id],
    enabled: true,
  }));
  const exitItem = { title: 'Exit', tooltip: 'Exit cc-footprint', checked: false, enabled: true };

  function update() {
    if (!systray) return;
    // One short line: the menu is as wide as its widest row. A claude process
    // without a session file is in the total, as in the statusline's, but is
    // no session.
    const pids = new Set(sessions.pids.values());
    let count = 0, total = 0;
    for (const [pid, d] of m.store) {
      total += d.mem;
      if (pids.has(pid)) count++;
    }
    const text = count === 0
      ? 'No active sessions'
      : `${count} session${count === 1 ? '' : 's'} · ${fmtMem(total)}`;
    statusItem.title = text;
    statusItem.tooltip = text;
    try {
      systray.sendAction({ type: 'update-item', item: statusItem });
    } catch {}
  }

  async function open(SysTray, items, renamed) {
    // The footprint, drawn by scripts/make-icon.py: an .ico in five sizes for
    // Windows, a .png for the macOS menu bar. systray2 takes it as base64.
    const icon = fs
      .readFileSync(path.join(__dirname, process.platform === 'win32' ? 'icon.ico' : 'icon.png'))
      .toString('base64');
    // systray2 offers no way to name the helper, so its spawn is redirected
    // for as long as it takes to start
    const spawn = childProcess.spawn;
    if (renamed && TRAY_HELPER) {
      childProcess.spawn = (file, ...rest) =>
        spawn(TRAY_HELPER.shipped.test(path.basename(file)) ? (ownTrayHelper(file, configDir) || file) : file, ...rest);
    }
    let tray;
    try {
      tray = new SysTray({
        menu: { icon, title: '', tooltip: 'cc-footprint', items },
        debug: false,
        copyDir: false,
      });
      await tray.ready();
    } finally {
      childProcess.spawn = spawn;
    }
    // Only now is it the tray to update: an action sent to a helper that
    // never answers would wait on it for good
    systray = tray;

    systray.onClick(action => {
      if (action.item === exitItem) {
        systray.kill(false);
        onExit();
        return;
      }
      const idx = toggleItems.indexOf(action.item);
      if (idx >= 0) {
        const id = config.items[idx].id;
        config.values[id] = !config.values[id];
        toggleItems[idx].checked = config.values[id];
        config.save();
        try {
          systray.sendAction({ type: 'update-item', item: toggleItems[idx] });
        } catch {}
        console.log(`[config] ${id} = ${config.values[id]}`);
      }
    });
  }

  async function start() {
    if (process.platform === 'linux') {
      console.log(`[tray] none on Linux: choose items by editing ${config.file}`);
      return;
    }
    let SysTray;
    try {
      SysTray = require('systray2').default;
    } catch {
      console.log('[tray] systray2 not installed, running headless');
      return;
    }

    for (let i = 0; i < config.items.length; i++) {
      toggleItems[i].checked = !!config.values[config.items[i].id];
    }
    // The toggles, a separator before each group
    const items = [statusItem];
    config.items.forEach((item, i) => {
      if (i === 0 || item.group !== config.items[i - 1].group) items.push(SysTray.separator);
      items.push(toggleItems[i]);
    });
    items.push(SysTray.separator, exitItem);

    // Under our own name first; the helper's own name where that cannot run
    for (const renamed of [true, false]) {
      try {
        await open(SysTray, items, renamed);
        console.log('[tray] ready');
        // The first measurement may have come in while the helper started
        if (m.lastMeasuredAt) update();
        return;
      } catch (e) {
        console.error(`[tray] failed${renamed ? ' under our own name, trying the helper as shipped' : ''}:`, e.message);
        systray = null;
      }
    }
  }

  return { start, update };
}

module.exports = { createTray };
