import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectText } from '../scripts/privacy-scan.mjs';

test('privacy checks reject common private material without printing matches', () => {
  assert.ok(inspectText('gh' + 'p_' + 'x'.repeat(30)).includes('github-token'));
  assert.ok(inspectText(['C:', 'Users', 'fictional', 'file'].join(String.fromCharCode(92))).includes('absolute-windows-path'));
  assert.ok(inspectText('-----BEGIN ' + 'PRIVATE KEY-----').includes('private-key'));
  assert.ok(inspectText('12345678' + '-1234'.repeat(3) + '-123456789abc').includes('uuid-identifier'));
  assert.deepEqual(inspectText('TRIP-001 ./project-control/state.db https://example.com'), []);
});
