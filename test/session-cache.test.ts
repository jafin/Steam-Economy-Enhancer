import { test } from 'vitest';
import assert from 'node:assert';
import { clearPriceCache, storageSession } from '../src/storage/session.ts';

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
    await storageSession.setItem(KEY, { lowest_sell_order: 187 });
    assert.notStrictEqual(await storageSession.getItem(KEY), null, 'the fixture is cached');

    assert.strictEqual(await clearPriceCache(), true);

    assert.strictEqual(await storageSession.getItem(KEY), null, 'and is gone afterwards');
});

test('clearPriceCache reports a refusal rather than throwing', async () => {
    // A browser can refuse site data outright -- private mode, disabled storage, quota --
    // and localforage rejects when it does. This is called straight from a click handler in
    // the settings dialog, where there is nothing above it to catch a rejection, so it has to
    // fail the same soft way the wrappers in storage/index.ts do.
    const realClear = storageSession.clear;
    storageSession.clear = () => Promise.reject(new Error('site data is disabled'));

    assert.strictEqual(await clearPriceCache(), false);

    storageSession.clear = realClear;
});
