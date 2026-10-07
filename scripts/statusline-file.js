'use strict';

// Puts this tool's statusline.sh in place without losing one of the
// person's own. The installers of every platform share it.
//
//   node statusline-file.js install <our statusline.sh> <~/.claude/statusline.sh>
//
// Prints one word for the installer to act on:
//   copied       there was none, or it was ours: replaced
//   backed-up    one of the person's own was there: copied to .bak first
//   kept-backup  one of their own was there, and a .bak already: the .bak
//                holds what was there before this tool and is kept
// Ours is recognized by "cc-footprint" in its first 5 lines.

const fs = require('fs');
const path = require('path');

const [action, src, dst] = process.argv.slice(2);
if (action !== 'install' || !src || !dst) {
  console.error('usage: statusline-file.js install <source> <destination>');
  process.exit(2);
}

const isOurs = file => fs.readFileSync(file, 'utf8').split(/\r?\n/).slice(0, 5).some(line => line.includes('cc-footprint'));

let said = 'copied';
if (fs.existsSync(dst) && !isOurs(dst)) {
  if (fs.existsSync(dst + '.bak')) {
    said = 'kept-backup';
  } else {
    fs.copyFileSync(dst, dst + '.bak');
    said = 'backed-up';
  }
}
fs.mkdirSync(path.dirname(dst), { recursive: true });
fs.copyFileSync(src, dst);
console.log(said);
