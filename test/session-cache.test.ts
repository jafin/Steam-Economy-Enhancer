import { test, vi } from 'vitest';
import assert from 'node:assert';
import { clearPriceCache, storageSessionInstance } from '../src/storage/session.ts';

// Emptying the price and order book cache by hand.
//
// The cache is what a page full of items is priced against, and it lasts the whole browsing
// session, so a copy taken while Steam was answering oddly outlives the moment that produced
// it. The settings dialog offers a button for this; the button is wiring, and this is the
// part with behaviour worth pinning.
//
// localforage runs for real here, the same as everywhere else in this suite.

const KEY = 'orderbook_730+Some Item';

test('clearPriceCache empties the cache for this session', async () => {
    await storageSessionInstance().setItem(KEY, { lowest_sell_order: 187 });
    assert.notStrictEqual(
        await storageSessionInstance().getItem(KEY),
        null,
        'the fixture is cached',
    );

    assert.strictEqual(await clearPriceCache(), true);

    assert.strictEqual(await storageSessionInstance().getItem(KEY), null, 'and is gone afterwards');
});

test('clearPriceCache reports a refusal rather than throwing', async () => {
    // A browser can refuse site data outright -- private mode, disabled storage, quota --
    // and localforage rejects when it does. This is called straight from a click handler in
    // the settings dialog, where there is nothing above it to catch a rejection, so it has to
    // fail the same soft way the wrappers in storage/index.ts do.
    const realClear = storageSessionInstance().clear;
    storageSessionInstance().clear = () => Promise.reject(new Error('site data is disabled'));

    assert.strictEqual(await clearPriceCache(), false);

    storageSessionInstance().clear = realClear;
});

// Importing storage/session.ts is inert.
//
// The module used to do all of its work at module evaluation: read window.location.href,
// create two localforage instances, write SETTING_LAST_CACHE and clear a database. That was
// the one remaining contradiction of main.ts's "importing this module is inert" contract
// (see the header there), and the reason test/setup.ts has to install Steam's globals before
// any test file's imports run.
//
// The rotation itself has not moved in production -- bootstrap() calls
// storageSessionInstance() once, so it still happens once per page load. What changed is that
// merely importing the module no longer triggers it.
test('importing the module does not touch the session storage or the cache counter', async () => {
    sessionStorage.clear();
    vi.resetModules();

    const before = window.localStorage.getItem('SETTING_LAST_CACHE');

    await import('../src/storage/session.ts');

    assert.strictEqual(
        sessionStorage.getItem('SESSION'),
        null,
        'importing must not claim a session database',
    );
    assert.strictEqual(
        window.localStorage.getItem('SETTING_LAST_CACHE'),
        before,
        'importing must not advance the rolling cache counter',
    );
});

test('asking for the instance is what claims a session database', async () => {
    sessionStorage.clear();
    vi.resetModules();

    const { storageSessionInstance: freshInstance } = await import('../src/storage/session.ts');

    assert.strictEqual(sessionStorage.getItem('SESSION'), null);

    freshInstance();

    assert.notStrictEqual(sessionStorage.getItem('SESSION'), null);
});

test('the instance is built once and reused', () => {
    assert.strictEqual(storageSessionInstance(), storageSessionInstance());
});
