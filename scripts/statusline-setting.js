'use strict';

// Points Claude Code's statusLine setting at this tool's script, or takes
// it away again, without disturbing anything else in settings.json: keys
// keep their order and the file its formatting. The installers of every
// platform share it.
//
//   node statusline-setting.js set   <settings.json> <statusline.sh>
//   node statusline-setting.js unset <settings.json> <statusline.sh>
//
// The script's path is given with forward slashes. Prints one word for the
// installer to act on:
//   set    same | refreshed | added | replaced:<previous command>
//          (refreshed: ours already, given the refreshInterval it lacked)
//          (before a replace the file is copied to <settings.json>.bak,
//          unless a .bak is there already: the first one holds the setting
//          from before this tool, and a later install must not lose it)
//   unset  removed | skip      (skip: the setting there is not ours)
// Exits 1, the file untouched, when it is not valid JSON.

const fs = require('fs');

const [action, file, script] = process.argv.slice(2);
if (!['set', 'unset'].includes(action) || !file || !script) {
  console.error('usage: statusline-setting.js set|unset <settings.json> <statusline.sh>');
  process.exit(2);
}

// The command Claude Code is to run. A path with a space in it (a home
// such as C:/Users/John Doe) must be quoted, in double quotes because
// cmd, PowerShell and sh all read those; any other path is left bare.
const bare = 'bash ' + script;
const command = /^[\w./:~+-]+$/.test(script) ? bare : `bash "${script}"`;

let settings = {};
try {
  if (fs.existsSync(file)) {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    if (text.trim()) settings = JSON.parse(text);
  }
} catch (e) {
  console.error(`${file}: ${e.message}`);
  process.exit(1);
}

const save = () => fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
const previous = settings.statusLine && settings.statusLine.command;
// The bare form of a path that needs quotes never ran, but it is ours too:
// it is what this script wrote before it quoted
const ours = previous === command || previous === bare;

// Claude Code reruns the script on events only, and they stop while a
// session is idle; the monitor's figures (memory, Remote Control) change
// without them, and a render that missed the monitor would stay as it was.
// A value the person has set is theirs.
const REFRESH = 30;

if (action === 'set') {
  const has = Boolean(settings.statusLine) && typeof settings.statusLine.refreshInterval === 'number';
  if (previous === command && has) {
    console.log('same');
  } else if (ours) {
    // The rest of ours is kept: the person may have added to it (padding)
    const refreshInterval = has ? settings.statusLine.refreshInterval : REFRESH;
    settings.statusLine = { ...settings.statusLine, type: 'command', command, refreshInterval };
    save();
    console.log(previous === command ? 'refreshed' : 'added');
  } else {
    if (previous && !fs.existsSync(file + '.bak')) fs.copyFileSync(file, file + '.bak');
    settings.statusLine = { type: 'command', command, refreshInterval: REFRESH };
    save();
    console.log(previous ? 'replaced:' + previous : 'added');
  }
} else if (ours) {
  delete settings.statusLine;
  save();
  console.log('removed');
} else {
  console.log('skip');
}
