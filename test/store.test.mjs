import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  initializeStore, openStore, registerTask, updateTask, addDecision, addEvidence,
  readTask, readProjectOverview, readRecentChanges,
} from '../src/store.mjs';
import { createWorkerWriter } from '../src/worker.mjs';

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'shared-state-test-'));
  const dbPath = join(directory, 'state.db');
  const db = initializeStore(dbPath);
  const connections = [db];
  t.after(() => {
    for (const connection of connections.reverse()) connection.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { db, dbPath, directory, open: (readOnly = true) => {
    const connection = openStore(dbPath, { readOnly });
    connections.push(connection);
    return connection;
  } };
}

const task = { task_id: 'itinerary.rain', title: '雨天室内备选', owner: 'worker.demo' };
const update = { task_id: task.task_id, actor: task.owner, expected_revision: 1, operation_id: 'op.start', status: 'in_progress' };
const errorCode = (code) => (error) => error.code === code;

test('initialization is explicit, preserves an initialized store, and rejects unrelated files', (t) => {
  const { db, dbPath, directory } = fixture(t);
  registerTask(db, task);
  const another = initializeStore(dbPath);
  assert.equal(readTask(another, { task_id: task.task_id }).task.revision, 1);
  another.close();
  const missing = join(directory, 'missing', 'state.db');
  assert.throws(() => openStore(missing), errorCode('STORE_NOT_FOUND'));
  assert.throws(() => openStore(missing, { readOnly: false }), errorCode('STORE_NOT_FOUND'));
  assert.equal(existsSync(join(directory, 'missing')), false);
  const unrelated = join(directory, 'unrelated.db');
  const other = new DatabaseSync(unrelated);
  other.exec('CREATE TABLE original(value TEXT); INSERT INTO original VALUES (\'keep\');');
  other.close();
  const before = readFileSync(unrelated);
  assert.throws(() => initializeStore(unrelated), errorCode('UNSUPPORTED_DATABASE'));
  assert.deepEqual(readFileSync(unrelated), before);
  const invalid = join(directory, 'text.db');
  writeFileSync(invalid, 'not a database');
  assert.throws(() => initializeStore(invalid));
  assert.equal(readFileSync(invalid, 'utf8'), 'not a database');
});

test('registration uses stable ids and explicit dedupe keys without duplicate events', (t) => {
  const { db } = fixture(t);
  const first = registerTask(db, { ...task, dedupe_key: 'logical.rain-option' });
  assert.equal(first.task.status, 'planned');
  assert.equal(first.task.revision, 1);
  assert.equal(first.replayed, false);
  assert.equal(registerTask(db, { ...task, dedupe_key: 'logical.rain-option' }).replayed, true);
  assert.throws(() => registerTask(db, { ...task, title: 'different', dedupe_key: 'logical.rain-option' }), errorCode('DUPLICATE_TASK'));
  assert.throws(() => registerTask(db, { ...task, task_id: 'another.rain', dedupe_key: 'logical.rain-option' }), errorCode('DUPLICATE_TASK'));
  assert.equal(readProjectOverview(db).total, 1);
  assert.equal(readRecentChanges(db).events.length, 1);
  updateTask(db, update);
  assert.equal(registerTask(db, { ...task, dedupe_key: 'logical.rain-option' }).task.status, 'in_progress');
  assert.equal(readRecentChanges(db).events.length, 2);
});

test('owner binding, optimistic revision checks, and operation replay prevent lost updates', (t) => {
  const { db, open } = fixture(t);
  registerTask(db, task);
  const concurrent = open(false);
  assert.throws(() => updateTask(db, { ...update, actor: 'worker.someone-else' }), errorCode('OWNER_MISMATCH'));
  const first = updateTask(db, update);
  assert.equal(first.task.revision, 2);
  assert.throws(() => updateTask(concurrent, { ...update, operation_id: 'op.other', checkpoint: 'older view' }), errorCode('REVISION_CONFLICT'));
  assert.equal(readTask(concurrent, { task_id: task.task_id }).task.checkpoint, '');
  const second = updateTask(concurrent, { ...update, expected_revision: 2, operation_id: 'op.next', status: 'blocked', checkpoint: 'Awaiting indoor opening hours' });
  assert.equal(second.task.revision, 3);
  const replay = updateTask(db, update);
  assert.deepEqual(replay, { ...first, replayed: true });
  assert.equal(replay.task.revision, 2, 'a retry receipt preserves the original operation result');
  assert.equal(readTask(db, { task_id: task.task_id }).task.revision, 3);
  assert.throws(() => updateTask(db, { ...update, status: 'done' }), errorCode('OPERATION_CONFLICT'));
  assert.equal(readRecentChanges(db).events.length, 3);
});

test('event insert failure rolls back task state and operation receipt atomically', (t) => {
  const { db } = fixture(t);
  registerTask(db, task);
  db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON execution_events BEGIN SELECT RAISE(ABORT, 'test event failure'); END;");
  assert.throws(() => updateTask(db, update), /test event failure/);
  assert.equal(readTask(db, { task_id: task.task_id }).task.revision, 1);
  assert.equal(db.prepare('SELECT count(*) AS n FROM operations').get().n, 0);
  assert.equal(readRecentChanges(db).events.length, 1);
  db.exec('DROP TRIGGER fail_event');
  assert.equal(updateTask(db, update).task.revision, 2);
});

test('decision, evidence, and execution remain separate; append failures are atomic', (t) => {
  const { db } = fixture(t);
  registerTask(db, task);
  const oldTimestamp = '2020-01-01T00:00:00.000Z';
  db.prepare('UPDATE tasks SET updated_at = ? WHERE task_id = ?').run(oldTimestamp, task.task_id);
  const decision = { task_id: task.task_id, actor: task.owner, expected_revision: 1, operation_id: 'op.decision', decision_id: 'decision.indoor', summary: 'Prefer an indoor option if it rains', rationale: 'Fictional teaching choice; no bookings.' };
  const evidence = { task_id: task.task_id, actor: task.owner, expected_revision: 2, operation_id: 'op.evidence', evidence_id: 'evidence.checklist', summary: 'A fictional local checklist was recorded', reference: 'demo/checklist.txt' };
  const decisionReceipt = addDecision(db, decision);
  assert.deepEqual(addDecision(db, decision), { ...decisionReceipt, replayed: true });
  addEvidence(db, evidence);
  const result = readTask(db, { task_id: task.task_id });
  assert.equal(result.task.revision, 3);
  assert.equal(result.task.status, 'planned');
  assert.equal(result.task.updated_at, oldTimestamp);
  assert.equal(result.staleness.status, 'stale');
  assert.equal(result.decisions.length, 1);
  assert.equal(result.evidence.length, 1);
  assert.equal(result.evidence[0].reference, 'demo/checklist.txt');
  assert.equal(Object.hasOwn(result.evidence[0], 'verified'), false);
  assert.throws(() => addDecision(db, { ...decision, expected_revision: 3, operation_id: 'op.overwrite' }), errorCode('RECORD_CONFLICT'));
  assert.equal(readTask(db, { task_id: task.task_id }).task.revision, 3);
  db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON execution_events BEGIN SELECT RAISE(ABORT, 'test event failure'); END;");
  assert.throws(() => addEvidence(db, { ...evidence, expected_revision: 3, operation_id: 'op.fail-evidence', evidence_id: 'evidence.rollback' }), /test event failure/);
  assert.equal(readTask(db, { task_id: task.task_id }).evidence.length, 1);
  assert.equal(readTask(db, { task_id: task.task_id }).task.revision, 3);
  assert.equal(readRecentChanges(db).events.length, 3);
});

test('read connections enforce SQLite read-only and do not create sidecar files or modify bytes', (t) => {
  const { db, dbPath, directory, open } = fixture(t);
  registerTask(db, task);
  const beforeBytes = readFileSync(dbPath);
  const beforeFiles = readdirSync(directory).sort();
  const reader = open();
  readTask(reader, { task_id: task.task_id });
  readProjectOverview(reader);
  readRecentChanges(reader);
  assert.throws(() => reader.exec("UPDATE tasks SET status = 'done'"), /readonly|read-only/i);
  assert.throws(() => reader.exec('CREATE TABLE unauthorized(x TEXT)'), /readonly|read-only/i);
  assert.throws(() => updateTask(reader, update), /readonly|read-only/i);
  assert.deepEqual(readFileSync(dbPath), beforeBytes);
  assert.deepEqual(readdirSync(directory).sort(), beforeFiles);
});

test('staleness reports past, future, invalid timestamps without claiming worker liveness', (t) => {
  const { db } = fixture(t);
  registerTask(db, task);
  assert.equal(readTask(db, { task_id: task.task_id }).staleness.status, 'fresh');
  for (const [timestamp, status, reason] of [
    ['2020-01-01T00:00:00.000Z', 'stale', null],
    ['2999-01-01T00:00:00.000Z', 'unknown', 'future_timestamp'],
    ['yesterday', 'unknown', 'invalid_timestamp'],
    ['2025-02-30T00:00:00.000Z', 'unknown', 'invalid_timestamp'],
  ]) {
    db.prepare('UPDATE tasks SET updated_at = ? WHERE task_id = ?').run(timestamp, task.task_id);
    const result = readTask(db, { task_id: task.task_id, stale_after_seconds: 60 });
    assert.equal(result.staleness.status, status);
    assert.equal(result.staleness.reason, reason);
    assert.equal(readProjectOverview(db).tasks[0].staleness.status, status);
    assert.equal(result.task.status, 'planned', 'freshness never rewrites task state');
  }
});

test('unknown keys, invalid ids, oversized strings, statuses, and paging are rejected', (t) => {
  const { db, dbPath } = fixture(t);
  registerTask(db, task);
  const rejects = [
    () => registerTask(db, { ...task, task_id: "x';DROP TABLE tasks;--" }),
    () => registerTask(db, { ...task, title: 'a'.repeat(241) }),
    () => registerTask(db, { ...task, owner: 'owner space' }),
    () => registerTask(db, { ...task, injected: true }),
    () => registerTask(db, { ...task, checkpoint: 'x\0y' }),
    () => updateTask(db, { ...update, status: 'approved' }),
    () => updateTask(db, { ...update, expected_revision: 0 }),
    () => updateTask(db, { ...update, operation_id: '../escape' }),
    () => updateTask(db, { ...update, checkpoint: 'a'.repeat(4001) }),
    () => updateTask(db, { ...update, title: 'rename' }),
    () => updateTask(db, { task_id: task.task_id, actor: task.owner, operation_id: 'op.nochange', expected_revision: 1 }),
    () => addDecision(db, { ...update, decision_id: 'd', summary: 's', rationale: 'r' }),
    () => readTask(db, { task_id: task.task_id, stale_after_seconds: 0 }),
    () => readTask(db, { task_id: task.task_id, other: true }),
    () => readProjectOverview(db, { limit: 201 }),
    () => readProjectOverview(db, { offset: -1 }),
    () => readRecentChanges(db, { after_event_id: 0.1 }),
    () => readRecentChanges(db, { limit: 0 }),
    () => openStore(dbPath, { readOnly: 'false' }),
    () => openStore(dbPath, { readOnly: true, writable: true }),
    () => readTask(db, []),
  ];
  for (const call of rejects) assert.throws(call, errorCode('VALIDATION_ERROR'));
  assert.equal(readRecentChanges(db).events.length, 1);
});

test('bound SQL preserves untrusted text and does not execute evidence references', (t) => {
  const { db } = fixture(t);
  const text = "Rain option'); DROP TABLE tasks; --";
  registerTask(db, { ...task, title: text });
  updateTask(db, { ...update, checkpoint: text });
  const dangerousReference = 'https://example.invalid/ignored; rm -rf /';
  addEvidence(db, { task_id: task.task_id, actor: task.owner, expected_revision: 2, operation_id: 'op.record-only', evidence_id: 'evidence.literal', summary: text, reference: dangerousReference });
  const result = readTask(db, { task_id: task.task_id });
  assert.equal(result.task.title, text);
  assert.equal(result.task.checkpoint, text);
  assert.equal(result.evidence[0].reference, dangerousReference);
  assert.equal(readProjectOverview(db).total, 1);
});

test('overview and event pagination preserve deterministic boundaries and task filtering', (t) => {
  const { db } = fixture(t);
  registerTask(db, task);
  registerTask(db, { ...task, task_id: 'itinerary.cafe' });
  updateTask(db, update);
  const overview = readProjectOverview(db, { limit: 1, offset: 1 });
  assert.equal(overview.total, 2);
  assert.equal(overview.tasks.length, 1);
  assert.equal(overview.tasks[0].task_id, task.task_id);
  const first = readRecentChanges(db, { limit: 1 });
  const next = readRecentChanges(db, { after_event_id: first.next_after_event_id });
  assert.deepEqual(next.events.map((entry) => entry.event_id), [2, 3]);
  const filtered = readRecentChanges(db, { task_id: task.task_id });
  assert.deepEqual(filtered.events.map((entry) => entry.event_id), [1, 3]);
  assert.equal(readRecentChanges(db, { after_event_id: 3 }).next_after_event_id, 3);
  assert.throws(() => readTask(db, { task_id: 'missing.task' }), errorCode('TASK_NOT_FOUND'));
});

test('worker writer captures task and owner and requires explicit revision and idempotency key', (t) => {
  const { db } = fixture(t);
  registerTask(db, task);
  const binding = { task_id: task.task_id, actor: task.owner };
  const writer = createWorkerWriter(db, binding);
  binding.actor = 'someone.else';
  const receipt = writer.write({ expected_revision: 1, operation_id: 'op.worker', checkpoint: 'Fictional indoor option drafted' });
  assert.equal(receipt.task.revision, 2);
  assert.equal(receipt.task.owner, task.owner);
  assert.throws(() => writer.write({ expected_revision: 2, operation_id: 'op.override', actor: 'someone.else', status: 'done' }), errorCode('VALIDATION_ERROR'));
  assert.throws(() => writer.write({ expected_revision: 2, status: 'done' }), errorCode('VALIDATION_ERROR'));
  assert.throws(() => writer.write({ operation_id: 'op.no-revision', status: 'done' }), errorCode('VALIDATION_ERROR'));
  assert.throws(() => createWorkerWriter(db, { ...binding, other: true }), errorCode('VALIDATION_ERROR'));
  assert.throws(() => createWorkerWriter(db, { task_id: 'valid', actor: 123 }), errorCode('VALIDATION_ERROR'));
});
