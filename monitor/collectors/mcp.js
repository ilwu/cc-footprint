'use strict';

// What marks a process as an MCP server, shared by every collector: its
// command line names one. The Chrome extension's bridge is counted too: it
// is what Claude Code's Chrome tools talk to, Chrome starts it and keeps it
// for as long as Chrome runs, and it belongs to no session.
const MCP = /mcp|modelcontextprotocol|chrome-native-host/i;

// A short name for the server, from its command line: the first word that
// names it (chrome-native-host, @modelcontextprotocol/server-filesystem,
// mcp-server-git), without its path, quotes, dashes or extension. In a path
// the name may be a folder (/x/mcp-server-git/index.js), so the last part
// that carries it is taken; a scoped package is kept whole. Empty when
// nothing in the line names one. Linux separates the words with NUL.
function label(cmdline) {
  for (const raw of (cmdline || '').split(/[\s\0]+/)) {
    const word = raw.replace(/^["']+|["']+$/g, '');
    if (!MCP.test(word)) continue;
    const parts = word.split(/[\\/]/).filter(part => MCP.test(part));
    const base = word.startsWith('@') ? word : parts[parts.length - 1];
    return base.replace(/^-+/, '').replace(/\.(bat|cmd|exe|js|mjs|cjs|py|sh)$/i, '');
  }
  return '';
}

module.exports = { MCP, label };
