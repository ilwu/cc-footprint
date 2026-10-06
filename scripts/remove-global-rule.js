'use strict';

// Takes this tool's marked block out of ~/.claude/CLAUDE.md and leaves
// everything else as it was. A file that held nothing else is deleted.
//
//   node remove-global-rule.js <CLAUDE.md>
//
// Prints removed | none.

const fs = require('fs');

const file = process.argv[2];
if (!file) {
  console.error('usage: remove-global-rule.js <CLAUDE.md>');
  process.exit(2);
}
if (!fs.existsSync(file)) {
  console.log('none');
  process.exit(0);
}

let text = fs.readFileSync(file, 'utf8');
let removed = false;
const start = text.indexOf('<!-- cc-footprint:browser-agent:start -->');
const endMark = '<!-- cc-footprint:browser-agent:end -->';
const end = text.indexOf(endMark);
if (start >= 0 && end > start) {
  text = (text.slice(0, start).trimEnd() + '\n\n' + text.slice(end + endMark.length).trimStart()).trim();
  removed = true;
}

if (!removed) {
  console.log('none');
} else {
  if (text) fs.writeFileSync(file, text + '\n');
  else fs.unlinkSync(file);
  console.log('removed');
}
