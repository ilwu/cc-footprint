'use strict';

// ── Items and their on/off settings ──────────────────────────────────
// Each item defines: id, label, the menu group it sits in, default enabled.
// The label is the English one; the tray shows i18n/<lang>.json's
// "item.<id>". config.json also holds `lang`: "auto" or a language code.
// The statusline reads the `display` list from the API to know what to
// render. Adding an item takes more than this line: see CLAUDE.md.
// A label must not hold "&": a Windows menu reads it as a shortcut mark
// and does not draw it.
const ITEMS = [
  { id: 'sys_mem',    label: 'System Memory',             group: 'memory',  default: true  },
  { id: 'claude_mem', label: 'Claude Memory',             group: 'memory',  default: true  },
  { id: 'mcp_mem',    label: 'MCP Memory',                group: 'memory',  default: true  },
  { id: 'ctx',        label: 'Context Window',            group: 'usage',   default: true  },
  { id: 'ctx_grow',   label: 'Context: Growth This Turn', group: 'usage',   default: true  },
  { id: 'ctx_src',    label: 'Context: Top Source',       group: 'usage',   default: false },
  { id: 'ctx_mcp',    label: 'Context: MCP Share',        group: 'usage',   default: true  },
  { id: 'five_hour',  label: '5h Usage',                  group: 'usage',   default: true  },
  { id: 'week',       label: 'Weekly Usage',              group: 'usage',   default: true  },
  { id: 'resets',     label: 'Limit Reset Countdown',     group: 'usage',   default: true  },
  { id: 'cost',       label: 'Session Cost ($)',          group: 'usage',   default: false },
  { id: 'remote',     label: 'Remote Control',            group: 'session', default: true  },
  { id: 'session_id', label: 'Session ID',                group: 'session', default: true  },
  { id: 'path',       label: 'Project Path',              group: 'session', default: true  },
  { id: 'model',      label: 'Model + Effort',            group: 'session', default: false },
  { id: 'lines',      label: 'Lines +/-',                 group: 'session', default: false },
  { id: 'duration',   label: 'Session Duration',          group: 'session', default: false },
  { id: 'plugin_hint', label: '/footprint Hint',           group: 'session', default: true  },
];

const fs = require('fs');
const path = require('path');

// The settings in `file` (~/.cc-footprint/config.json). `values` is the
// live object: the tray flips its entries and saves.
function createConfig(file) {
  const dir = path.dirname(file);
  // broken: the file is there but holds no settings (a comma too many, made
  // by hand). It is then left as it is, so that the person can mend it,
  // and the settings in use are the last good ones (or the defaults).
  const self = { file, items: ITEMS, values: {}, broken: false };
  let mtime = 0;

  self.load = () => {
    let values = {};
    let broken = false;
    try {
      if (fs.existsSync(file)) {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
        // A file holding null or a list is as good as one that does not parse
        if (saved && typeof saved === 'object' && !Array.isArray(saved)) values = saved;
        else broken = true;
      }
    } catch {
      broken = true;
    }
    self.broken = broken;
    if (broken) {
      console.error(`[config] ${file} holds no settings it can read: left as it is, the last good ones in use`);
      if (Object.keys(self.values).length > 0) return;
    }
    // Defaults for missing items; the language follows the system's
    for (const item of ITEMS) {
      if (values[item.id] === undefined) values[item.id] = item.default;
    }
    if (typeof values.lang !== 'string') values.lang = 'auto';
    // In place, so that whoever holds `values` sees the change
    for (const k of Object.keys(self.values)) delete self.values[k];
    Object.assign(self.values, values);
  };

  // A choice made in the tray is saved even over a broken file, whose text
  // is kept beside it as config.json.broken
  self.save = () => {
    try {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (self.broken) {
        try { fs.copyFileSync(file, file + '.broken'); } catch {}
        self.broken = false;
      }
      fs.writeFileSync(file, JSON.stringify(self.values, null, 2));
    } catch (e) {
      console.error('[config] save failed:', e.message);
    }
  };

  // The tray writes the file; where there is no tray the person edits it by
  // hand, so a change on disk is picked up on the next request.
  self.refresh = () => {
    try {
      const m = fs.statSync(file).mtimeMs;
      if (m !== mtime) {
        mtime = m;
        self.load();
      }
    } catch {}
  };

  self.display = () => ITEMS.filter(i => self.values[i.id]).map(i => i.id);

  return self;
}

module.exports = { ITEMS, createConfig };
