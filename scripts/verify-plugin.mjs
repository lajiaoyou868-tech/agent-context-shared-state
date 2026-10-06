import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectText } from './privacy-scan.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const manifest = json('.codex-plugin/plugin.json');
const marketplace = json('.agents/plugins/marketplace.json');
const mcp = json('.mcp.json');
const identity = 'agent-context-shared-state';
assert.equal(manifest.name, identity);
assert.equal(manifest.version, json('package.json').version);
assert.equal(manifest.mcpServers, './.mcp.json');
assert.match(manifest.description, /Local-only, Desktop-only alpha/);
assert.ok(manifest.interface.displayName);
assert.deepEqual(Object.keys(manifest).sort(), ['description', 'interface', 'license', 'mcpServers', 'name', 'version']);
assert.equal(marketplace.name, 'shared-state-local-alpha');
assert.ok(marketplace.interface.displayName);
assert.deepEqual(marketplace.plugins, [{ name: identity, source: { source: 'local', path: './' },
  policy: { installation: 'AVAILABLE', authentication: 'ON_USE' }, category: 'Productivity' }]);
assert.equal(resolve(root, marketplace.plugins[0].source.path), resolve(root));
assert.deepEqual(mcp, { mcpServers: { 'shared-state': { command: 'node',
  args: ['src/mcp-server.mjs', '--db', 'project-control/state.db'], cwd: '.' } } });
for (const value of [manifest, marketplace, mcp]) assert.deepEqual(inspectText(JSON.stringify(value)), []);

const temporaryRoot = join(root, 'work', 'plugin-check');
mkdirSync(temporaryRoot, { recursive: true });
const temporary = mkdtempSync(join(temporaryRoot, 'relocated plugin '));
const bundle = join(temporary, 'installed copy');
// A bounded relocation fixture, not a second maintained implementation or an installer.
const files = ['.codex-plugin/plugin.json', '.mcp.json', '.agents/plugins/marketplace.json',
  'src/mcp-server.mjs', 'src/config.mjs', 'src/store.mjs', 'src/protocol.mjs', 'examples/sun-rain/demo.mjs'];
const digest = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const fingerprint = directory => Object.fromEntries(readdirSync(directory).sort().map(name => [name, digest(join(directory, name))]));
const server = mcp.mcpServers['shared-state'];
const environment = { ...process.env, SHARED_STATE_DB: join(temporary, 'unselected', 'state.db') };
function run(args, cwd, input = '') {
  const result = spawnSync(process.execPath, args, { cwd, env: environment, input,
    encoding: 'utf8', windowsHide: true, shell: false, timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}
try {
  for (const file of files) {
    const destination = join(bundle, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(root, file), destination);
    assert.equal(digest(destination), digest(join(root, file)));
  }
  // Resolve cwd from the installed plugin root, independently of the caller's cwd.
  const cwd = resolve(bundle, server.cwd);
  assert.ok(existsSync(resolve(cwd, server.args[0])));
  const beforeMissing = readdirSync(bundle).sort();
  const missing = run(server.args, cwd);
  assert.equal(missing.status, 1);
  assert.equal(missing.stdout, '');
  assert.match(missing.stderr, /STATE_STORE_UNAVAILABLE/);
  assert.deepEqual(readdirSync(bundle).sort(), beforeMissing);
  const demo = run(['examples/sun-rain/demo.mjs', '--db', 'project-control/state.db'], cwd);
  assert.equal(demo.status, 0, demo.stderr);
  const control = join(bundle, 'project-control');
  const before = fingerprint(control);
  const requests = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25',
      capabilities: {}, clientInfo: { name: 'local-plugin-check', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'read_project_overview' } },
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'read_task', arguments: { task_id: 'TRIP-001' } } },
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'read_recent_changes' } },
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'update_task', arguments: {} } },
  ];
  const session = run(server.args, cwd, requests.map(value => JSON.stringify(value)).join('\n') + '\n');
  assert.equal(session.status, 0, session.stderr);
  const responses = session.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.deepEqual(responses.map(value => value.id), [1, 2, 3, 4, 5, 6]);
  assert.equal(responses[0].result.protocolVersion, '2025-11-25');
  const tools = responses[1].result.tools;
  assert.deepEqual(tools.map(tool => tool.name).sort(), ['read_project_overview', 'read_recent_changes', 'read_task']);
  assert.ok(tools.every(tool => tool.annotations.readOnlyHint === true));
  for (const response of responses.slice(2, 5)) assert.equal(response.result.isError, false);
  assert.equal(responses[2].result.structuredContent.tasks[0].task_id, 'TRIP-001');
  assert.equal(responses[3].result.structuredContent.task.revision, 4);
  assert.equal(responses[3].result.structuredContent.task.status, 'in_progress');
  assert.equal(responses[4].result.structuredContent.events.length, 4);
  assert.equal(responses[5].error.code, -32602);
  assert.deepEqual(fingerprint(control), before);
  assert.equal(existsSync(environment.SHARED_STATE_DB), false);
  process.stdout.write(JSON.stringify({ status: 'PASS', checks: ['manifest and marketplace contract',
    'relative installed paths with spaces', 'unchanged source bytes', 'missing database fails closed',
    'exactly three read tools', 'demo reads', 'write tool rejected', 'unchanged database bytes'],
    limitation: 'Relocation and protocol proof; actual Desktop installation and fresh-chat blind test remain separate.' }, null, 2) + '\n');
} finally {
  const target = resolve(temporary);
  assert.ok(target.startsWith(resolve(temporaryRoot) + sep));
  rmSync(target, { recursive: true, force: true });
}
