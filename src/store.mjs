import { DatabaseSync } from 'node:sqlite';
import { closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const APPLICATION_ID = 0x41535354;
const SCHEMA_VERSION = 1;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const STATUSES = new Set(['planned', 'in_progress', 'blocked', 'done', 'cancelled']);
const TASK_COLUMNS = 'task_id, dedupe_key, title, status, owner, checkpoint, next_action, revision, created_at, updated_at';

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function object(value, allowed, required = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail('VALIDATION_ERROR', 'Expected a plain object.');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || !allowed.includes(key)) {
      fail('VALIDATION_ERROR', 'Unknown input field.');
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) fail('VALIDATION_ERROR', `Missing ${key}.`);
  }
  return value;
}

function string(value, name, max, empty = false) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0') ||
      (!empty && value.trim().length === 0)) {
    fail('VALIDATION_ERROR', `Invalid ${name}; expected ${empty ? 'at most' : '1 to'} ${max} characters without NUL.`);
  }
  return value;
}

function id(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) fail('VALIDATION_ERROR', `Invalid ${name}.`);
  return value;
}

function integer(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    fail('VALIDATION_ERROR', `Invalid ${name}; expected an integer from ${min} to ${max}.`);
  }
  return value;
}

function path(value) {
  string(value, 'dbPath', 4096);
  return value === ':memory:' ? value : resolve(value);
}

function configure(db) {
  db.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF; PRAGMA busy_timeout = 5000;');
  return db;
}

function verifySchema(db) {
  const applicationId = db.prepare('PRAGMA application_id').get().application_id;
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (applicationId !== APPLICATION_ID || schemaVersion !== SCHEMA_VERSION) {
    fail('UNSUPPORTED_DATABASE', 'Database is not a supported initialized Shared State store.');
  }
}

/** Explicit initialization only. Existing unrelated databases are never adopted. */
export function initializeStore(dbPath) {
  const target = path(dbPath);
  let created = target === ':memory:';
  if (!created && !existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true });
    try {
      closeSync(openSync(target, 'wx', 0o600));
      created = true;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  const db = configure(new DatabaseSync(target));
  try {
    if (!created) {
      verifySchema(db);
      return db;
    }
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        dedupe_key TEXT NOT NULL UNIQUE,
        title TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('planned','in_progress','blocked','done','cancelled')),
        owner TEXT NOT NULL,
        checkpoint TEXT NOT NULL,
        next_action TEXT NOT NULL,
        revision INTEGER NOT NULL CHECK(revision >= 1),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        registration_json TEXT NOT NULL CHECK(json_valid(registration_json))
      ) STRICT;
      CREATE TABLE execution_events (
        event_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        event_type TEXT NOT NULL,
        actor TEXT NOT NULL,
        task_revision INTEGER NOT NULL,
        operation_id TEXT UNIQUE,
        recorded_at TEXT NOT NULL,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
      ) STRICT;
      CREATE INDEX events_by_task ON execution_events(task_id, event_id);
      CREATE TABLE decisions (
        decision_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        rationale TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX decisions_by_task ON decisions(task_id, recorded_at);
      CREATE TABLE evidence (
        evidence_id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        actor TEXT NOT NULL,
        summary TEXT NOT NULL,
        reference TEXT NOT NULL,
        recorded_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX evidence_by_task ON evidence(task_id, recorded_at);
      CREATE TABLE operations (
        operation_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
        receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json))
      ) STRICT;
      PRAGMA application_id = ${APPLICATION_ID};
      PRAGMA user_version = ${SCHEMA_VERSION};
      COMMIT;
    `);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** Missing files fail. A read connection never initializes files or directories. */
export function openStore(dbPath, options = {}) {
  object(options, ['readOnly']);
  const readOnly = Object.hasOwn(options, 'readOnly') ? options.readOnly : true;
  if (typeof readOnly !== 'boolean') fail('VALIDATION_ERROR', 'readOnly must be boolean.');
  const target = path(dbPath);
  if (target === ':memory:' || !existsSync(target)) fail('STORE_NOT_FOUND', 'Initialize the store before opening it.');
  const db = configure(new DatabaseSync(target, { readOnly }));
  try {
    verifySchema(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function transaction(db, action) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getTask(db, taskId) {
  const task = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE task_id = ?`).get(taskId);
  if (!task) fail('TASK_NOT_FOUND', 'Task does not exist.');
  return { ...task };
}

function event(db, task, type, actor, operationId, payload, now) {
  const result = db.prepare(`INSERT INTO execution_events
    (task_id, event_type, actor, task_revision, operation_id, recorded_at, payload_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(task.task_id, type, actor, task.revision, operationId, now, JSON.stringify(payload));
  return Number(result.lastInsertRowid);
}

export function registerTask(db, input) {
  object(input, ['task_id', 'dedupe_key', 'title', 'owner', 'checkpoint', 'next_action'], ['task_id', 'title', 'owner']);
  const payload = {
    task_id: id(input.task_id, 'task_id'),
    dedupe_key: id(Object.hasOwn(input, 'dedupe_key') ? input.dedupe_key : input.task_id, 'dedupe_key'),
    title: string(input.title, 'title', 240),
    owner: id(input.owner, 'owner'),
    checkpoint: string(Object.hasOwn(input, 'checkpoint') ? input.checkpoint : '', 'checkpoint', 4000, true),
    next_action: string(Object.hasOwn(input, 'next_action') ? input.next_action : '', 'next_action', 4000, true),
  };
  const serialized = JSON.stringify(payload);
  return transaction(db, () => {
    const existing = db.prepare('SELECT task_id, registration_json FROM tasks WHERE task_id = ? OR dedupe_key = ?').all(payload.task_id, payload.dedupe_key);
    if (existing.length) {
      if (existing.length !== 1 || existing[0].task_id !== payload.task_id || existing[0].registration_json !== serialized) {
        fail('DUPLICATE_TASK', 'The task id or dedupe key is already registered with different content.');
      }
      const firstEvent = db.prepare("SELECT event_id FROM execution_events WHERE task_id = ? AND event_type = 'task_registered' ORDER BY event_id LIMIT 1").get(payload.task_id);
      return { task: getTask(db, payload.task_id), event_id: firstEvent.event_id, replayed: true };
    }
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO tasks (${TASK_COLUMNS}, registration_json)
      VALUES (?, ?, ?, 'planned', ?, ?, ?, 1, ?, ?, ?)`)
      .run(payload.task_id, payload.dedupe_key, payload.title, payload.owner, payload.checkpoint, payload.next_action, now, now, serialized);
    const task = getTask(db, payload.task_id);
    return { task, event_id: event(db, task, 'task_registered', payload.owner, null, payload, now), replayed: false };
  });
}

function mutationInput(input, extra, required = extra) {
  const base = ['task_id', 'actor', 'expected_revision', 'operation_id'];
  object(input, [...base, ...extra], [...base, ...required]);
  return {
    task_id: id(input.task_id, 'task_id'),
    actor: id(input.actor, 'actor'),
    expected_revision: integer(input.expected_revision, 'expected_revision', 1, Number.MAX_SAFE_INTEGER - 1),
    operation_id: id(input.operation_id, 'operation_id'),
  };
}

function mutate(db, type, payload, apply) {
  const serialized = JSON.stringify({ type, ...payload });
  return transaction(db, () => {
    const previous = db.prepare('SELECT payload_json, receipt_json FROM operations WHERE operation_id = ?').get(payload.operation_id);
    if (previous) {
      if (previous.payload_json !== serialized) fail('OPERATION_CONFLICT', 'operation_id is already used by a different request.');
      return { ...JSON.parse(previous.receipt_json), replayed: true };
    }
    const task = getTask(db, payload.task_id);
    if (task.owner !== payload.actor) fail('OWNER_MISMATCH', 'Only the recorded task owner can write this task through this API.');
    if (task.revision !== payload.expected_revision) fail('REVISION_CONFLICT', 'Task revision changed; read the task before retrying.');
    const now = new Date().toISOString();
    apply(task, now);
    const updated = getTask(db, payload.task_id);
    const receipt = { task: updated, event_id: event(db, updated, type, payload.actor, payload.operation_id, payload, now), replayed: false };
    db.prepare('INSERT INTO operations (operation_id, payload_json, receipt_json) VALUES (?, ?, ?)').run(payload.operation_id, serialized, JSON.stringify(receipt));
    return receipt;
  });
}

export function updateTask(db, input) {
  const payload = mutationInput(input, ['status', 'checkpoint', 'next_action'], []);
  const keys = ['status', 'checkpoint', 'next_action'].filter((key) => Object.hasOwn(input, key));
  if (keys.length === 0) fail('VALIDATION_ERROR', 'Supply status, checkpoint, or next_action.');
  for (const key of keys) {
    if (key === 'status') {
      if (!STATUSES.has(input.status)) fail('VALIDATION_ERROR', 'Invalid task status.');
      payload.status = input.status;
    } else {
      payload[key] = string(input[key], key, 4000, true);
    }
  }
  return mutate(db, 'task_updated', payload, (task, now) => {
    const result = db.prepare(`UPDATE tasks SET status = ?, checkpoint = ?, next_action = ?, revision = revision + 1, updated_at = ? WHERE task_id = ? AND revision = ?`)
      .run(payload.status ?? task.status, payload.checkpoint ?? task.checkpoint, payload.next_action ?? task.next_action, now, payload.task_id, payload.expected_revision);
    if (Number(result.changes) !== 1) fail('REVISION_CONFLICT', 'Task revision changed.');
  });
}

export function addDecision(db, input) {
  const payload = {
    ...mutationInput(input, ['decision_id', 'summary', 'rationale']),
    decision_id: id(input.decision_id, 'decision_id'),
    summary: string(input.summary, 'summary', 2000),
    rationale: string(input.rationale, 'rationale', 8000),
  };
  return mutate(db, 'decision_recorded', payload, (_task, now) => {
    if (db.prepare('SELECT 1 FROM decisions WHERE decision_id = ?').get(payload.decision_id)) fail('RECORD_CONFLICT', 'decision_id already exists; decisions are append-only.');
    db.prepare('INSERT INTO decisions (decision_id, task_id, actor, summary, rationale, recorded_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(payload.decision_id, payload.task_id, payload.actor, payload.summary, payload.rationale, now);
    db.prepare('UPDATE tasks SET revision = revision + 1 WHERE task_id = ? AND revision = ?').run(payload.task_id, payload.expected_revision);
  });
}

export function addEvidence(db, input) {
  const payload = {
    ...mutationInput(input, ['evidence_id', 'summary', 'reference']),
    evidence_id: id(input.evidence_id, 'evidence_id'),
    summary: string(input.summary, 'summary', 2000),
    reference: string(input.reference, 'reference', 2000),
  };
  return mutate(db, 'evidence_recorded', payload, (_task, now) => {
    if (db.prepare('SELECT 1 FROM evidence WHERE evidence_id = ?').get(payload.evidence_id)) fail('RECORD_CONFLICT', 'evidence_id already exists; evidence is append-only.');
    db.prepare('INSERT INTO evidence (evidence_id, task_id, actor, summary, reference, recorded_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(payload.evidence_id, payload.task_id, payload.actor, payload.summary, payload.reference, now);
    db.prepare('UPDATE tasks SET revision = revision + 1 WHERE task_id = ? AND revision = ?').run(payload.task_id, payload.expected_revision);
  });
}

function threshold(input) {
  return integer(Object.hasOwn(input, 'stale_after_seconds') ? input.stale_after_seconds : 86400, 'stale_after_seconds', 1, 31536000);
}

function staleness(updatedAt, seconds, now) {
  const parsed = Date.parse(updatedAt);
  const valid = Number.isFinite(parsed) && new Date(parsed).toISOString() === updatedAt;
  const age = valid ? (Date.parse(now) - parsed) / 1000 : null;
  const reason = !valid ? 'invalid_timestamp' : age < 0 ? 'future_timestamp' : null;
  return {
    status: reason ? 'unknown' : age >= seconds ? 'stale' : 'fresh',
    reason,
    read_at: now,
    age_seconds: reason ? null : age,
    threshold_seconds: seconds,
  };
}

export function readTask(db, input) {
  object(input, ['task_id', 'stale_after_seconds'], ['task_id']);
  const taskId = id(input.task_id, 'task_id');
  const seconds = threshold(input);
  // A deferred read transaction keeps the three layers on one SQLite snapshot.
  db.exec('BEGIN');
  try {
    const task = getTask(db, taskId);
    const decisions = db.prepare('SELECT decision_id, task_id, actor, summary, rationale, recorded_at FROM decisions WHERE task_id = ? ORDER BY recorded_at, decision_id').all(taskId).map((row) => ({ ...row }));
    const evidence = db.prepare('SELECT evidence_id, task_id, actor, summary, reference, recorded_at FROM evidence WHERE task_id = ? ORDER BY recorded_at, evidence_id').all(taskId).map((row) => ({ ...row }));
    const result = { task, decisions, evidence, staleness: staleness(task.updated_at, seconds, new Date().toISOString()) };
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function readProjectOverview(db, input = {}) {
  object(input, ['limit', 'offset', 'stale_after_seconds']);
  const limit = integer(Object.hasOwn(input, 'limit') ? input.limit : 50, 'limit', 1, 200);
  const offset = integer(Object.hasOwn(input, 'offset') ? input.offset : 0, 'offset', 0, Number.MAX_SAFE_INTEGER);
  const seconds = threshold(input);
  db.exec('BEGIN');
  try {
    const read_at = new Date().toISOString();
    const total = db.prepare('SELECT count(*) AS total FROM tasks').get().total;
    const tasks = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks ORDER BY task_id LIMIT ? OFFSET ?`).all(limit, offset)
      .map((task) => ({ ...task, staleness: staleness(task.updated_at, seconds, read_at) }));
    db.exec('COMMIT');
    return { tasks, total, limit, offset, read_at };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function readRecentChanges(db, input = {}) {
  object(input, ['limit', 'after_event_id', 'task_id']);
  const limit = integer(Object.hasOwn(input, 'limit') ? input.limit : 50, 'limit', 1, 200);
  const after = integer(Object.hasOwn(input, 'after_event_id') ? input.after_event_id : 0, 'after_event_id', 0, Number.MAX_SAFE_INTEGER);
  const taskId = Object.hasOwn(input, 'task_id') ? id(input.task_id, 'task_id') : null;
  const where = taskId === null ? 'event_id > ?' : 'event_id > ? AND task_id = ?';
  const params = taskId === null ? [after, limit] : [after, taskId, limit];
  const events = db.prepare(`SELECT event_id, task_id, event_type, actor, task_revision, operation_id, recorded_at, payload_json FROM execution_events WHERE ${where} ORDER BY event_id LIMIT ?`)
    .all(...params).map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) }));
  return { events, next_after_event_id: events.at(-1)?.event_id ?? after };
}
