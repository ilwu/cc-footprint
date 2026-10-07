'use strict';

// The end of every installer: the optional global optimizations, listed,
// never applied (they change ~/.claude/ for every project). Under Claude
// Code (CLAUDECODE is set) the AI running the installer is told to ask
// first and to merge rather than overwrite. The installers of every
// platform share it.
//
//   node optional.js <this clone> <~/.claude>
//
// Prints UTF-8 lines (install.ps1 reads them through Invoke-Node, as Windows
// PowerShell 5.1 would otherwise take them in the system code page and
// garble a path that is not ASCII); a line starting with "#" is a heading,
// which the installer colors.

const fs = require('fs');
const path = require('path');

const [dir, claudeDir] = process.argv.slice(2);
if (!dir || !claudeDir) {
  console.error('usage: optional.js <clone> <~/.claude>');
  process.exit(2);
}

let applied = false;
try {
  applied = fs.readFileSync(path.join(claudeDir, 'CLAUDE.md'), 'utf8').includes('cc-footprint:browser-agent:start');
} catch {}

const lines = [
  '#Optional: global optimizations',
  'Not applied automatically - they change ~/.claude/ for every project.',
];
if (applied) {
  lines.push('- Browser subagent: already applied');
} else {
  lines.push(
    '- Browser subagent: hand multi-step Chrome work to a subagent with a',
    '  short context, so browser-heavy sessions cost much less.',
    "  How to apply: README.md -> 'Hand browser work to a subagent'",
  );
  if (process.env.CLAUDECODE) {
    lines.push(
      '',
      '#[For the AI assistant running this installer]',
      'Ask the user whether to apply the browser subagent optimization.',
      'Do not apply it without a yes. To apply:',
      `  1. Copy ${path.join(dir, 'claude', 'agents', 'browser.md')}`,
      '     to ~/.claude/agents/browser.md. If that file already exists,',
      '     show the user how it differs and ask before replacing it.',
      `  2. Append the full contents of ${path.join(dir, 'claude', 'global-rule.md')}`,
      '     (start/end markers included) to the end of ~/.claude/CLAUDE.md.',
      '     Keep everything already in that file.',
      '  3. Tell the user to restart open Claude Code sessions.',
    );
  }
}
console.log(lines.join('\n'));
