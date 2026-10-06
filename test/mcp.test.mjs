import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initializeStore, registerTask, addDecision, addEvidence } from '../src/store.mjs';

const serverPath = fileURLToPath(new URL('../src/mcp-server.mjs', import.meta.url));
const temporaryRoot = fileURLToPath(new URL('../work/mcp-tests', import.meta.url));
const protocolVersion = '2025-11-25';
const taskId = 'trip.rain-option';
const childSessions = new Map();

function fixture(t, initialized = true) {
  mkdirSync(temporaryRoot, { recursive: true });
  const root = mkdtempSync(join(temporaryRoot, 'shared-state-mcp-'));
  childSessions.set(root, []);
  t.after(async () => {
    for (const session of childSessions.get(root)) {
      if (session.child.exitCode === null && session.child.signalCode === null) session.child.kill();
      await session.closed;
    }
    childSessions.delete(root);
    const target = resolve(root);
    assert.ok(target.startsWith(resolve(temporaryRoot) + sep));
    assert.ok(basename(target).startsWith('shared-state-mcp-'));
    rmSync(target, { recursive: true, force: true });
  });
  const dbPath = join(root, 'state.db');
  if (initialized) {
    const db = initializeStore(dbPath);
    try {
      registerTask(db, { task_id: taskId, title: '晴雨行程：雨天备选', owner: 'demo-worker',
        checkpoint: '室内场馆清单已列出', next_action: '核对虚构营业时间' });
      addDecision(db, { task_id: taskId, actor: 'demo-worker', expected_revision: 1,
        operation_id: 'decision.op', decision_id: 'rain.preference',
        summary: '下雨时优先室内活动', rationale: '完全虚构的教学决定' });
      addEvidence(db, { task_id: taskId, actor: 'demo-worker', expected_revision: 2,
        operation_id: 'evidence.op', evidence_id: 'rain.fixture',
        summary: '教学场馆清单', reference: 'examples/fictional-venues.txt' });
    } finally { db.close(); }
  }
  return { root, dbPath };
}

function fingerprint(root) {
  return Object.fromEntries(readdirSync(root).sort().map(name => [name,
    createHash('sha256').update(readFileSync(join(root, name))).digest('hex')]));
}

function startServer(t, root, args) {
  const child = spawn(process.execPath, [serverPath, ...args], {
    cwd: root, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, SHARED_STATE_DB: 'unselected.db' },
  });
  const queue = [];
  const pending = [];
  const lines = [];
  let text = '';
  let stderr = '';
  let finished = false;
  let startupError;
  const closed = new Promise(resolveClose => {
    child.once('error', error => { startupError = error; });
    child.once('close', (code, signal) => {
      finished = true;
      for (const waiter of pending.splice(0)) {
        clearTimeout(waiter.timer);
        waiter.reject(startupError ?? new Error(`Server closed before response (${code}, ${signal}).`));
      }
      resolveClose({ code, signal, stderr, tail: text, lines, startupError });
    });
  });
  childSessions.get(root).push({ child, closed });
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.on('error', () => {});
  child.stdout.on('data', chunk => {
    text += chunk;
    let newline;
    while ((newline = text.indexOf('\n')) !== -1) {
      const line = text.slice(0, newline);
      text = text.slice(newline + 1);
      lines.push(line);
      const waiter = pending.shift();
      if (waiter) { clearTimeout(waiter.timer); waiter.resolve(line); }
      else queue.push(line);
    }
  });
  function next() {
    if (queue.length) return Promise.resolve(queue.shift());
    if (finished) return Promise.reject(startupError ?? new Error('Server is closed.'));
    return new Promise((resolveLine, reject) => {
      const waiter = { resolve: resolveLine, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = pending.indexOf(waiter);
        if (index !== -1) pending.splice(index, 1);
        reject(new Error('Timed out waiting for a protocol response.'));
      }, 4000);
      pending.push(waiter);
    });
  }
  const write = value => child.stdin.write(JSON.stringify(value) + '\n');
  const rpc = async (id, method, params) => {
    write({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
    const response = JSON.parse(await next());
    assert.equal(response.jsonrpc, '2.0');
    assert.equal(response.id, id);
    assert.notEqual(Object.hasOwn(response, 'result'), Object.hasOwn(response, 'error'));
    return response;
  };
  const stop = async () => {
    child.stdin.end();
    let timer;
    try {
      return await Promise.race([closed, new Promise((_, reject) => {
        timer = setTimeout(() => { child.kill(); reject(new Error('Server did not exit on EOF.')); }, 4000);
      })]);
    } finally { clearTimeout(timer); }
  };
  t.after(async () => {
    if (!finished) { child.kill(); await closed; }
  });
  return { rpc, write, next, stop, closed, raw: text => child.stdin.write(text) };
}

async function initialize(session, requested = protocolVersion) {
  const initialized = await session.rpc('init', 'initialize', {
    protocolVersion: requested, capabilities: {}, clientInfo: { name: 'fictional-test-client', version: '1.0.0' },
  });
  assert.equal(initialized.result.protocolVersion, protocolVersion);
  assert.deepEqual(Object.keys(initialized.result.capabilities), ['tools']);
  session.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

function successfulTool(response) {
  assert.equal(response.error, undefined);
  assert.equal(response.result.isError, false);
  assert.equal(response.result.content[0].type, 'text');
  assert.deepEqual(JSON.parse(response.result.content[0].text), response.result.structuredContent);
  return response.result.structuredContent;
}

test('MCP subprocess exposes exactly three read tools and leaves database bytes and directory unchanged', { timeout: 15000 }, async t => {
  const { root, dbPath } = fixture(t);
  const before = fingerprint(root);
  const session = startServer(t, root, ['--db', dbPath]);
  assert.equal((await session.rpc(0, 'tools/list')).error.message, 'NOT_INITIALIZED');
  const result = await session.rpc('init', 'initialize', {
    protocolVersion, capabilities: {}, clientInfo: { name: 'fictional-test-client', version: '1.0.0' },
  });
  assert.equal(result.result.protocolVersion, protocolVersion);
  assert.deepEqual(Object.keys(result.result.capabilities), ['tools']);
  assert.equal((await session.rpc(1, 'tools/list')).error.message, 'NOT_INITIALIZED');
  session.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.deepEqual((await session.rpc('ping-string-id', 'ping')).result, {});

  const catalog = (await session.rpc(2, 'tools/list')).result.tools;
  assert.deepEqual(catalog.map(tool => tool.name).sort(), ['read_project_overview', 'read_recent_changes', 'read_task']);
  for (const tool of catalog) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.inputSchema.additionalProperties, false);
  }
  const overview = successfulTool(await session.rpc(3, 'tools/call', { name: 'read_project_overview' }));
  assert.equal(overview.tasks.length, 1);
  assert.equal(overview.tasks[0].task_id, taskId);
  const task = successfulTool(await session.rpc(4, 'tools/call', { name: 'read_task', arguments: { task_id: taskId } }));
  assert.equal(task.task.checkpoint, '室内场馆清单已列出');
  assert.equal(task.decisions[0].decision_id, 'rain.preference');
  assert.equal(task.evidence[0].evidence_id, 'rain.fixture');
  assert.ok(['fresh', 'stale', 'unknown'].includes(task.staleness.status));
  const changes = successfulTool(await session.rpc(5, 'tools/call', { name: 'read_recent_changes', arguments: { task_id: taskId } }));
  assert.deepEqual(changes.events.map(event => event.event_type), ['task_registered', 'decision_recorded', 'evidence_recorded']);
  const missing = await session.rpc(6, 'tools/call', { name: 'read_task', arguments: { task_id: 'trip.missing' } });
  assert.equal(missing.result.isError, true);

  for (const name of ['update_task', 'register_task', 'constructor', '__proto__', '../../writer', 'read_task; DROP TABLE tasks']) {
    const response = await session.rpc(`unknown:${name}`, 'tools/call', { name, arguments: {} });
    assert.equal(response.error.code, -32602);
  }
  assert.equal((await session.rpc('write-method', 'state/update', {})).error.code, -32601);
  session.write({ jsonrpc: '2.0', method: 'notifications/fictional' });
  assert.deepEqual((await session.rpc('last-ping', 'ping')).result, {});
  const exit = await session.stop();
  assert.equal(exit.code, 0);
  assert.equal(exit.tail, '');
  assert.deepEqual(fingerprint(root), before);
});

test('MCP rejects tool argument values and extra fields without modifying state', { timeout: 15000 }, async t => {
  const { root, dbPath } = fixture(t);
  const before = fingerprint(root);
  const session = startServer(t, root, ['--db', dbPath]);
  await initialize(session);
  const tools = (await session.rpc('catalog', 'tools/list')).result.tools;
  const maxLimit = tools.find(tool => tool.name === 'read_project_overview').inputSchema.properties.limit.maximum;
  const cases = [
    ['read_task', { task_id: taskId, db: '../other.db' }],
    ['read_task', { task_id: "trip' OR 1=1--" }],
    ['read_task', { task_id: taskId, stale_after_seconds: 0 }],
    ['read_task', {}],
    ['read_project_overview', { limit: maxLimit + 1 }],
    ['read_project_overview', { offset: -1 }],
    ['read_recent_changes', { after_event_id: -1 }],
    ['read_recent_changes', { limit: 1.5 }],
    ['read_task', JSON.parse('{"task_id":"trip.rain-option","__proto__":{"approved":true}}')],
  ];
  for (let index = 0; index < cases.length; index++) {
    const [name, args] = cases[index];
    const response = await session.rpc(`bad-args:${index}`, 'tools/call', { name, arguments: args });
    assert.equal(response.result?.isError, true, `Rejected tool input must be a tool execution error: ${index}`);
  }
  const exit = await session.stop();
  assert.equal(exit.code, 0);
  assert.deepEqual(fingerprint(root), before);
});

test('MCP rejects explicit null protocol arguments and malformed initialization notification', { timeout: 15000 }, async t => {
  const { root, dbPath } = fixture(t);
  const session = startServer(t, root, ['--db', dbPath]);
  await session.rpc('init', 'initialize', {
    protocolVersion, capabilities: {}, clientInfo: { name: 'fictional-test-client', version: '1.0.0' },
  });
  session.write({ jsonrpc: '2.0', method: 'notifications/initialized', params: [] });
  assert.equal((await session.rpc('still-not-ready', 'tools/list')).error?.message, 'NOT_INITIALIZED');
  session.write({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal((await session.rpc('null-params', 'tools/list', null)).error?.code, -32602);
  assert.equal((await session.rpc('null-args', 'tools/call', { name: 'read_project_overview', arguments: null })).error?.code, -32602);
  assert.equal((await session.rpc('array-args', 'tools/call', { name: 'read_task', arguments: [] })).error?.code, -32602);
  assert.equal((await session.rpc('repeat-init', 'initialize', {})).error?.code, -32600);
  assert.equal((await session.stop()).code, 0);
});

test('MCP handles malformed JSON, invalid envelopes, oversized fragmented lines and recovery', { timeout: 15000 }, async t => {
  const { root, dbPath } = fixture(t);
  const before = fingerprint(root);
  const session = startServer(t, root, ['--db', dbPath]);
  session.raw('{malformed\n');
  assert.equal(JSON.parse(await session.next()).error.code, -32700);
  session.raw('[]\n');
  assert.equal(JSON.parse(await session.next()).error.code, -32600);
  session.write({ jsonrpc: '2.0', id: null, method: 'ping' });
  assert.equal(JSON.parse(await session.next()).error.code, -32600);
  session.raw('x'.repeat(40000));
  session.raw('x'.repeat(40000) + '\n');
  const large = JSON.parse(await session.next());
  assert.equal(large.error.code, -32600);
  assert.equal(large.error.message, 'REQUEST_TOO_LARGE');
  await initialize(session, 'unsupported-future-version');
  assert.deepEqual((await session.rpc('after-bad-input', 'ping')).result, {});
  const value = successfulTool(await session.rpc('still-readable', 'tools/call', { name: 'read_task', arguments: { task_id: taskId } }));
  assert.equal(value.task.task_id, taskId);
  const exit = await session.stop();
  assert.equal(exit.code, 0);
  assert.equal(exit.tail, '');
  assert.deepEqual(fingerprint(root), before);
});

test('MCP does not initialize a missing database or create its parent directory', { timeout: 10000 }, async t => {
  const { root } = fixture(t, false);
  const before = readdirSync(root);
  const session = startServer(t, root, ['--db', 'missing-folder/state.db']);
  const exit = await session.stop();
  assert.equal(exit.code, 1);
  assert.deepEqual(exit.lines, []);
  assert.equal(exit.tail, '');
  assert.equal(exit.stderr.trim(), 'STATE_STORE_UNAVAILABLE');
  assert.deepEqual(readdirSync(root), before);
});

test('MCP rejects writer input-file option without touching existing database', { timeout: 10000 }, async t => {
  const { root, dbPath } = fixture(t);
  const before = fingerprint(root);
  const session = startServer(t, root, ['--db', dbPath, '--input', 'fictional.json']);
  const exit = await session.stop();
  assert.equal(exit.code, 1);
  assert.deepEqual(exit.lines, []);
  assert.deepEqual(fingerprint(root), before);
});
