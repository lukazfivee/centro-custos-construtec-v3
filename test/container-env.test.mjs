import test from 'node:test';
import assert from 'node:assert/strict';
import { compactContainerEnv } from '../cloudflare/center-container/containerEnv.mjs';

test('remove valores ausentes antes de iniciar o Container', () => {
  assert.deepEqual(compactContainerEnv({
    DATABASE_URL: 'postgres://example',
    SYNC_API_URL: undefined,
    INSTANCE_NAME: 'undefined',
    EMPTY_BUT_INTENTIONAL: '',
    ZERO: 0,
  }), {
    DATABASE_URL: 'postgres://example',
    EMPTY_BUT_INTENTIONAL: '',
    ZERO: 0,
  });
});
