import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const source = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = mkdtempSync(join(tmpdir(), 'shared-state-clone-'));
const destination = join(temporary, 'candidate');
const cache = join(temporary, 'npm-cache');
mkdirSync(cache);
function run(command, args, cwd) {
  const environment = { ...process.env, npm_config_cache: cache, npm_config_update_notifier: 'false', npm_config_offline: 'true' };
  delete environment.SHARED_STATE_DB;
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', windowsHide: true,
    env: environment, timeout: 120000 });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.error?.message || result.stdout}`);
  return result.stdout;
}
try {
  const commit = run('git', ['rev-parse', 'HEAD'], source).trim();
  run('git', ['clone', '--no-local', '--quiet', source, destination], temporary);
  // npm exposes its executable JS path to scripts; no shell is required on Windows.
  const npmPath = process.env.npm_execpath;
  if (!npmPath) throw new Error('Run with npm run verify:clone');
  run(process.execPath, [npmPath, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--offline'], destination);
  run(process.execPath, ['--test'], destination);
  const dbPath = join(temporary, 'new-control', 'state.db');
  const call = (...args) => run(process.execPath, args, destination);
  call('examples/sun-rain/demo.mjs', '--db', dbPath);
  const first = JSON.parse(call('src/cli.mjs', 'task', '--db', dbPath, '--input', 'examples/sun-rain/task.json'));
  if (first.task.revision !== 4 || first.task.status !== 'in_progress') throw new Error('DEMO_FAILED');
  call('src/cli.mjs', 'update', '--db', dbPath, '--input', 'examples/sun-rain/update.json');
  call('src/cli.mjs', 'update', '--db', dbPath, '--input', 'examples/sun-rain/update.json');
  call('examples/sun-rain/demo.mjs', '--db', dbPath);
  const final = JSON.parse(call('src/cli.mjs', 'task', '--db', dbPath, '--input', 'examples/sun-rain/task.json'));
  const changes = JSON.parse(call('src/cli.mjs', 'changes', '--db', dbPath));
  if (final.task.revision !== 5 || final.task.status !== 'blocked' || changes.events.length !== 5) throw new Error('REPLAY_FAILED');
  const scan = JSON.parse(call('scripts/privacy-scan.mjs'));
  if (scan.findings.length) throw new Error('SCAN_FAILED');
  process.stdout.write(JSON.stringify({ status: 'PASS', commit, environment: 'same-machine fresh clone', node: process.version,
    checks: ['empty-cache offline npm ci', 'test suite', 'new database demo', 'worker update', 'idempotent retry', 'privacy scan'] }, null, 2) + '\n');
} finally {
  // Only the mkdtemp-created child is removed, after checking its resolved parent.
  if (resolve(temporary).startsWith(resolve(tmpdir()) + (process.platform === 'win32' ? '\\' : '/'))) rmSync(temporary, { recursive: true, force: true });
}
