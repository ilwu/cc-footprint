'use strict';

// Points Claude Code's statusLine setting at this tool's script, or takes
// it away again, without disturbing anything else in settings.json: keys
// keep their order and the file its formatting. The installers of every
// platform share it.
//
//   node statusline-setting.js set   <settings.json> <command>
//   node statusline-setting.js unset <settings.json> <command>
//
// Prints one word for the installer to act on:
//   set    same | added | replaced:<previous command>
//          (before a replace the file is copied to <settings.json>.bak)
//   unset  removed | skip      (skip: the setting there is not ours)
// Exits 1, the file untouched, when it is not valid JSON.

const fs = require('fs');

const [action, file, command] = process.argv.slice(2);
if (!['set', 'unset'].includes(action) || !file || !command) {
  console.error('usage: statusline-setting.js set|unset <settings.json> <command>');
  process.exit(2);
}

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

if (action === 'set') {
  if (previous === command) {
    console.log('same');
  } else {
    if (previous) fs.copyFileSync(file, file + '.bak');
    settings.statusLine = { type: 'command', command };
    save();
    console.log(previous ? 'replaced:' + previous : 'added');
  }
} else if (previous === command) {
  delete settings.statusLine;
  save();
  console.log('removed');
} else {
  console.log('skip');
}
