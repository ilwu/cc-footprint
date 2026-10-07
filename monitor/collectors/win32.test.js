'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseOutput } = require('./win32');

test("the script's records make the table, the servers named, the widths kept", () => {
  const { table, clock, cols } = parseOutput([
    'T,1700000000000',
    'P,100,1,419430400,1699999000000,claude.exe',
    'W,100,120',
    'P,101,100,8388608,1699999001000,cmd.exe',
    'M,101,C:\\WINDOWS\\system32\\cmd.exe /d /s /c ""C:\\Users\\me\\.claude\\chrome\\chrome-native-host.bat" chrome-extension://abc/"',
    'P,102,100,41943040,1699999002000,node.exe',
    'M,102,node C:\\x\\node_modules\\.bin\\server-mcp --port 3000',
    'P,103,1,1024,1699999003000,A name, with a comma.exe',
    'W,999,0',
    '',
  ].join('\r\n'));

  assert.equal(clock, 1700000000000);
  assert.deepEqual(table, [
    { pid: 100, ppid: 1, mem: 419430400, born: 1699999000000, name: 'claude.exe', mcp: null },
    { pid: 101, ppid: 100, mem: 8388608, born: 1699999001000, name: 'cmd.exe', mcp: 'chrome-native-host' },
    { pid: 102, ppid: 100, mem: 41943040, born: 1699999002000, name: 'node.exe', mcp: 'server-mcp' },
    { pid: 103, ppid: 1, mem: 1024, born: 1699999003000, name: 'A name, with a comma.exe', mcp: null },
  ]);
  assert.deepEqual([...cols], [[100, 120]]); // a width of 0 means none was read
});
