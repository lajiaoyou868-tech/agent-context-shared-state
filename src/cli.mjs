#!/usr/bin/env node
import { readFileSync, statSync } from 'node:fs';
import { parseOptions } from './config.mjs';
import { initializeStore, openStore, registerTask, updateTask, addDecision, addEvidence,
  readTask, readProjectOverview, readRecentChanges } from './store.mjs';

const commands = {
  register: [registerTask, true], update: [updateTask, true],
  decision: [addDecision, true], evidence: [addEvidence, true],
  task: [readTask, false], overview: [readProjectOverview, false], changes: [readRecentChanges, false],
};
let db;
try {
  const [command, ...args] = process.argv.slice(2);
  if (command === 'help' || !command) {
    process.stdout.write('state init|register|update|decision|evidence|task|overview|changes [--db relative/path.db] [--input file.json]\n');
  } else {
    if (command !== 'init' && !Object.hasOwn(commands, command)) throw new Error('UNKNOWN_COMMAND');
    const { dbPath, inputPath } = parseOptions(args);
    if (command === 'init') {
      if (inputPath) throw new Error('INIT_TAKES_NO_INPUT');
      db = initializeStore(dbPath);
      process.stdout.write(JSON.stringify({ initialized: true }) + '\n');
    } else {
      const [fn, writes] = commands[command];
      if (inputPath && statSync(inputPath).size > 65536) throw new Error('INPUT_TOO_LARGE');
      const input = inputPath ? JSON.parse(readFileSync(inputPath, 'utf8')) : {};
      db = openStore(dbPath, { readOnly: !writes });
      process.stdout.write(JSON.stringify(fn(db, input), null, 2) + '\n');
    }
  }
} catch (error) {
  const code = error.code && /^[A-Z_]+$/.test(error.code) ? error.code :
    /^[A-Z_]+$/.test(error.message) ? error.message : 'COMMAND_FAILED';
  process.stderr.write(JSON.stringify({ error: code }) + '\n');
  process.exitCode = 1;
} finally { db?.close(); }
