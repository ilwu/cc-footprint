'use strict';

// A collector lists the machine's processes; everything after that is
// shared (proctree.js). Each platform's module exports:
//
//   prepare(configDir)           once, at startup
//   collect(sessionPids, done)   done(err, { table, clock, cols, systemPct })
//
// table      rows of { pid, ppid, mem, born, name, mcp } (see proctree.js)
// clock      "now" on the clock `born` is measured on, ms
// cols       Map pid -> terminal columns, for the session processes
// systemPct  machine memory in use, 0-100, or null when unknown
const modules = { win32: './win32', linux: './linux', darwin: './darwin' };

const file = modules[process.platform];
module.exports = file ? require(file) : null;
