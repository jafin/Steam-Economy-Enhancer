'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadUserscript } = require('./harness.js');

test('the userscript loads under Node with the stubbed page globals', () => {
    assert.doesNotThrow(() => loadUserscript());
});

test('loading twice returns the same module, so side effects run once', () => {
    assert.strictEqual(loadUserscript(), loadUserscript());
});
