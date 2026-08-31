// The settings store's read side.
//
// getSetting replaced getSettingWithDefault, which had no per-key return type:
// localStorage.getItem answers with a string, and the defaults table (settings/index.ts)
// holds numbers, so a key used to answer with a number until it had been written once and a
// string forever after. getSetting coerces every read to a number instead. The first two
// tests below started as characterisation of that bug and were updated in place, from what
// the coercion bug produced to what the fix produces, rather than left to bit-rot as stale
// characterisation.

import { test, beforeEach, vi } from 'vitest';
import assert from 'node:assert';
import {
    getSetting,
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
        getSetting(SETTING_PRICE_HISTORY_HOURS),
        settingDefaults.SETTING_PRICE_HISTORY_HOURS,
    );
});

test('a key written once still answers with a number', () => {
    setSetting(SETTING_PRICE_HISTORY_HOURS, 5);

    assert.strictEqual(getSetting(SETTING_PRICE_HISTORY_HOURS), 5);
});

test('SETTING_LAST_CACHE now adds instead of concatenating', () => {
    // Same trace as the coercion bug this replaced (see TASK-08-typed-settings.md's problem
    // statement), but every step is now a number: run 1 reads the numeric default, run 2
    // reads back the number run 1 wrote, and 1 + 1 adds instead of concatenating.
    assert.strictEqual(getSetting(SETTING_LAST_CACHE), 0);
    setSetting(SETTING_LAST_CACHE, getSetting(SETTING_LAST_CACHE) + 1);

    assert.strictEqual(getSetting(SETTING_LAST_CACHE), 1);
    setSetting(SETTING_LAST_CACHE, getSetting(SETTING_LAST_CACHE) + 1);

    assert.strictEqual(getSetting(SETTING_LAST_CACHE), 2);
});

// storage/session.ts reads and writes SETTING_LAST_CACHE the first time the session cache is
// asked for, and memoises the instance per module instance -- so a fresh "session" is
// simulated by resetting the module registry and clearing sessionStorage (localStorage, which
// is what actually carries the counter, is left alone -- it is what survives between real
// browsing sessions).
async function newSessionDatabaseName(): Promise<string> {
    sessionStorage.clear();
    vi.resetModules();
    const { storageSessionInstance } = await import('../src/storage/session.ts');

    // LocalForageOptions.name is optional; this instance is always created with one.
    return String(storageSessionInstance().config().name);
}

test('three consecutive sessions pick three different cache databases', async () => {
    const names = [
        await newSessionDatabaseName(),
        await newSessionDatabaseName(),
        await newSessionDatabaseName(),
    ];

    assert.strictEqual(new Set(names).size, 3, `expected 3 distinct databases, got ${names}`);
});

test('the rolling cache cycles through five databases, then repeats', async () => {
    const names: string[] = [];
    for (let i = 0; i < 6; i++) {
        names.push(await newSessionDatabaseName());
    }

    assert.strictEqual(
        new Set(names.slice(0, 5)).size,
        5,
        `expected 5 distinct databases, got ${names}`,
    );
    assert.strictEqual(names[5], names[0], 'the sixth session should reuse the first database');
});
