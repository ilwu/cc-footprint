'use strict';

// Whether our plugin is enabled for the user, read from Claude Code's own
// settings.json. Re-read when the file changes, so the statusline hint
// flips on the render after an install or uninstall rather than a minute
// later. `installed` is null when nobody can tell.

const fs = require('fs');

function createPluginState(settingsFile) {
  const self = { installed: null };
  let mtime = 0;

  self.check = () => {
    try {
      const m = fs.statSync(settingsFile).mtimeMs;
      if (m === mtime) return;
      mtime = m;
      const settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8').replace(/^﻿/, ''));
      const enabled = settings.enabledPlugins || {};
      self.installed = Object.keys(enabled).some(k => k.startsWith('cc-footprint@') && enabled[k] === true);
    } catch {
      mtime = 0;
      self.installed = null;
    }
  };

  return self;
}

module.exports = { createPluginState };
