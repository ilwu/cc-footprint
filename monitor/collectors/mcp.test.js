'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { label } = require('./mcp');

test('an MCP server is named by the word of its command line that names it', () => {
  // Chrome's bridge: the .bat Chrome runs, and the claude it runs in turn
  assert.equal(label('C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\Users\\me\\.claude\\chrome\\chrome-native-host.bat" chrome-extension://abc/"'), 'chrome-native-host');
  assert.equal(label('"C:\\Users\\me\\.local\\bin\\claude.exe"  "--chrome-native-host"'), 'chrome-native-host');
  // Servers behind npx, a scoped package kept whole
  assert.equal(label('cmd /c npx -y @modelcontextprotocol/server-filesystem C:\\work'), '@modelcontextprotocol/server-filesystem');
  assert.equal(label('node /Users/me/x/node_modules/.bin/server-mcp --port 3000'), 'server-mcp');
  assert.equal(label('C:\\py\\python.exe -m mcp_server_time'), 'mcp_server_time');
  // Linux separates the words with NUL
  assert.equal(label('node\0/x/mcp-server-git/index.js\0--repo\0/x'), 'mcp-server-git');
  // A scoped package run by its path keeps its whole name
  assert.equal(label('node C:\\nm\\@modelcontextprotocol\\server-filesystem\\dist\\index.js'), '@modelcontextprotocol/server-filesystem');
  assert.equal(label('node /nm/@acme/mcp-server-x/index.js'), '@acme/mcp-server-x');
  // Claude Code serving itself as an MCP server
  assert.equal(label('"C:\\x\\claude.exe" mcp serve'), 'claude mcp serve');
  // Nothing names one
  assert.equal(label('"C:\\Users\\me\\.local\\bin\\claude.exe"'), '');
  assert.equal(label(''), '');
});
