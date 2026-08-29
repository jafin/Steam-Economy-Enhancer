// The settings store's read side.
//
// getSettingWithDefault has no per-key return type: localStorage.getItem answers with a
// string, and the defaults table (settings/index.ts) holds numbers, so a key answers with a
// number until it has been written once and a string forever after. These three tests pin
// that behaviour before it is fixed, so the fix is a deliberate, visible change to a test
// rather than a silent one.

import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';
import {
    getSettingWithDefault,
    setSetting,
    SETTING_PRICE_HISTORY_HOURS,
    SETTING_LAST_CACHE,
    settingDefaults,
} from '../src/settings/index.ts';

beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
});

test('a key that has never been written answers with its numeric default', () => {
    assert.strictEqual(
        getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS),
        settingDefaults.SETTING_PRICE_HISTORY_HOURS,
    );
});

test('a key written once answers with a string, today', () => {
    setSetting(SETTING_PRICE_HISTORY_HOURS, 5);

    assert.strictEqual(getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS), '5');
});

test('SETTING_LAST_CACHE runs away under string concatenation, today', () => {
    // Reproduces the trace from TASK-08's problem statement: run 1 reads the numeric
    // default, run 2 reads back the string that run 1 wrote, and "1" + 1 concatenates
    // instead of adding.
    assert.strictEqual(getSettingWithDefault(SETTING_LAST_CACHE), 0);
    setSetting(SETTING_LAST_CACHE, getSettingWithDefault(SETTING_LAST_CACHE) + 1);

    assert.strictEqual(getSettingWithDefault(SETTING_LAST_CACHE), '1');
    setSetting(SETTING_LAST_CACHE, getSettingWithDefault(SETTING_LAST_CACHE) + 1);

    assert.strictEqual(getSettingWithDefault(SETTING_LAST_CACHE), '11');
});

// storage/session.ts reads and writes SETTING_LAST_CACHE at module-evaluation time, so a
// fresh "session" is simulated by resetting the module registry and clearing sessionStorage
// (localStorage, which is what actually carries the counter, is left alone -- it is what
// survives between real browsing sessions).
async function newSessionDatabaseName() {
    sessionStorage.clear();
    vi.resetModules();
    const { storageSession } = await import('../src/storage/session.ts');
    return storageSession.config().name;
}

test('three consecutive sessions pick three different cache databases', async () => {
    const names = [
        await newSessionDatabaseName(),
        await newSessionDatabaseName(),
        await newSessionDatabaseName(),
    ];

    assert.strictEqual(new Set(names).size, 3, `expected 3 distinct databases, got ${names}`);
});
