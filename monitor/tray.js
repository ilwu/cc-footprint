'use strict';

// ── System tray (Windows) / menu bar icon (macOS) ────────────────────
// One switch per item, a status line on top, then the Language menu and
// Exit. There is no tray on Linux: the items and the language are chosen
// by editing config.json.

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

// config: see config.js; i18n: see i18n.js; m: the monitor's state;
// sessions: see sessions.js; onExit: what Exit does after closing the icon.
function createTray({ config, i18n, m, sessions, configDir, onExit }) {
  let systray = null;
  let lang = null; // the language the menu is drawn in

  const statusItem = { title: '', tooltip: '', checked: false, enabled: false };
  const toggleItems = config.items.map(() => ({ title: '', tooltip: '', checked: false, enabled: true }));
  // "Language" stays English in every language, so that whoever chose one
  // they cannot read still finds the way back. Each language is named in
  // itself.
  const langChoices = ['auto', ...i18n.codes];
  const langItems = langChoices.map(() => ({ title: '', tooltip: '', checked: false, enabled: true }));
  const langMenu = { title: 'Language', tooltip: 'Language', checked: false, enabled: true, items: langItems };
  const exitItem = { title: '', tooltip: '', checked: false, enabled: true };

  // Every title in the language config.json asks for
  function label() {
    lang = i18n.resolve(config.values.lang);
    const t = (key, vars) => i18n.t(lang, key, vars);
    config.items.forEach((item, i) => {
      const title = t('item.' + item.id);
      toggleItems[i].title = title;
      toggleItems[i].tooltip = t('toggle', { label: title });
      toggleItems[i].checked = !!config.values[item.id];
    });
    langChoices.forEach((code, i) => {
      const title = code === 'auto' ? i18n.t(lang, 'lang.auto', { name: i18n.name(i18n.system) }) : i18n.name(code);
      langItems[i].title = title;
      langItems[i].tooltip = title;
      langItems[i].checked = (config.values.lang || 'auto') === code;
    });
    exitItem.title = t('exit');
    exitItem.tooltip = t('exit.tooltip');
    statusLine();
  }

  function statusLine() {
    const t = (key, vars) => i18n.t(lang, key, vars);
    if (!m.lastMeasuredAt) {
      statusItem.title = statusItem.tooltip = t('collecting');
      return;
    }
    // One short line: the menu is as wide as its widest row. A claude process
    // without a session file is in the total, as in the statusline's, but is
    // no session.
    const pids = new Set(sessions.pids.values());
    let count = 0, total = 0;
    for (const [pid, d] of m.store) {
      total += d.mem;
      if (pids.has(pid)) count++;
    }
    const text = count === 0 ? t('status.none') : t('status.sessions', { n: count, mem: fmtMem(total) });
    statusItem.title = text;
    statusItem.tooltip = text;
  }

  const send = item => {
    try {
      systray.sendAction({ type: 'update-item', item });
    } catch {}
  };

  // Drawn again in place, item by item: update-menu would break the clicks
  function relabel() {
    label();
    for (const item of [statusItem, ...toggleItems, ...langItems, exitItem]) send(item);
  }

  // After every measurement; config.json edited by hand may have changed
  // the language too
  function update() {
    if (!systray) return;
    if (i18n.resolve(config.values.lang) !== lang) return relabel();
    statusLine();
    send(statusItem);
    // A tick that no longer matches config.json (edited by hand) is put
    // right, or the next click would turn the item the other way than shown
    config.items.forEach((item, i) => {
      const on = !!config.values[item.id];
      if (toggleItems[i].checked !== on) {
        toggleItems[i].checked = on;
        send(toggleItems[i]);
      }
    });
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
      // config.json as it is now, edits made by hand since the last read
      // included, so that saving the click does not undo them
      config.refresh();
      const idx = toggleItems.indexOf(action.item);
      if (idx >= 0) {
        const id = config.items[idx].id;
        config.values[id] = !config.values[id];
        toggleItems[idx].checked = config.values[id];
        config.save();
        send(toggleItems[idx]);
        console.log(`[config] ${id} = ${config.values[id]}`);
        return;
      }
      const li = langItems.indexOf(action.item);
      if (li >= 0) {
        config.values.lang = langChoices[li];
        config.save();
        relabel();
        console.log(`[config] lang = ${config.values.lang}`);
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

    label();
    // The toggles, a separator before each group
    const items = [statusItem];
    config.items.forEach((item, i) => {
      if (i === 0 || item.group !== config.items[i - 1].group) items.push(SysTray.separator);
      items.push(toggleItems[i]);
    });
    items.push(SysTray.separator, langMenu, exitItem);

    // Under our own name first; the helper's own name where that cannot run
    for (const renamed of [true, false]) {
      try {
        await open(SysTray, items, renamed);
        console.log('[tray] ready');
        // The first measurement may have come in while the helper started
        update();
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
