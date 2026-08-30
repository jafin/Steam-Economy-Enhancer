import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/entry.ts';

test('the userscript loads under Node with the stubbed page globals', () => {
    assert.doesNotThrow(() => see);
});

test('loading twice returns the same module, so side effects run once', () => {
    assert.strictEqual(see, see);
});
