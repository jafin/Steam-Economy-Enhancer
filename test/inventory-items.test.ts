import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// readInventoryItems is the one reader getInventoryItems (the inventory page) and
// getTradeOfferInventoryItems (the trade offer page) both call now, parameterised by the two
// property names Steam spells the same shape with on each page.

test('a missing active inventory answers an empty array, not a throw', () => {
    assert.deepStrictEqual(see.readInventoryItems(null, 'm_rgChildInventories', 'm_rgAssets'), []);
    assert.deepStrictEqual(see.readInventoryItems(undefined, 'rgChildInventories', 'rgInventory'), []);
});

test('flattens items out of child inventories, merging each one\'s own description', () => {
    const activeInventory = {
        m_rgChildInventories: {
            753: {
                m_rgAssets: {
                    123: {
                        appid: 753,
                        description: { name: 'Gems', tags: [] }
                    }
                }
            }
        }
    };

    const items = see.readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'Gems', 'the description was merged onto the item');
    assert.strictEqual(items[0].id, '123');
    assert.strictEqual(items[0].assetid, '123');
});

test('falls back to the top-level assets when there are no child inventories', () => {
    // Some inventories (e.g. BattleBlock Theater) do not have child inventories.
    const activeInventory = {
        m_rgChildInventories: {},
        m_rgAssets: {
            456: {
                appid: 12,
                description: { name: 'Only item' }
            }
        }
    };

    const items = see.readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'Only item');
});

test('collects both child-inventory items and top-level items together', () => {
    const activeInventory = {
        m_rgChildInventories: {
            753: {
                m_rgAssets: {
                    1: { description: { name: 'From a child inventory' } }
                }
            }
        },
        m_rgAssets: {
            2: { description: { name: 'From the top level' } }
        }
    };

    const items = see.readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');
    const names = items.map((item) => item.name).sort();

    assert.deepStrictEqual(names, ['From a child inventory', 'From the top level']);
});

test('skips entries that are not objects', () => {
    // Steam's asset maps sometimes carry non-item metadata keys alongside the real assets.
    const activeInventory = {
        m_rgChildInventories: {},
        m_rgAssets: {
            length: 1,
            1: { description: { name: 'A real item' } }
        }
    };

    const items = see.readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'A real item');
});

test('the same reader works for the trade offer page\'s different property names', () => {
    const activeInventory = {
        rgChildInventories: {
            753: {
                rgInventory: {
                    1: { description: { name: 'Trade offer item' } }
                }
            }
        }
    };

    const items = see.readInventoryItems(activeInventory, 'rgChildInventories', 'rgInventory');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'Trade offer item');
});

test('does not mutate Steam\'s own inventory objects', () => {
    // readInventoryItems used to Object.assign the description straight onto Steam's own
    // item and stamp an id on it - a real mutation of an object Steam still owns. It
    // returns new objects now; the source is untouched.
    const steamOwnedItem = { appid: 730, description: { name: 'Gems' } };
    const activeInventory = {
        m_rgChildInventories: {},
        m_rgAssets: { 123: steamOwnedItem }
    };

    const items = see.readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.notStrictEqual(items[0], steamOwnedItem, 'a new object, not the same reference');
    assert.strictEqual(steamOwnedItem.name, undefined, 'Steam\'s own item was never touched');
    assert.strictEqual(steamOwnedItem.id, undefined);
    assert.strictEqual(items[0].name, 'Gems', 'the returned copy is flattened, though');
});

test('flattenItem merges the description onto a new object without touching the source', () => {
    const source = { appid: 730, description: { name: 'Gems', tags: [] } };

    const item = see.flattenItem(source, '123');

    assert.notStrictEqual(item, source);
    assert.strictEqual(item.name, 'Gems');
    assert.strictEqual(item.id, '123');
    assert.strictEqual(item.assetid, '123');
    assert.strictEqual(source.name, undefined);
    assert.strictEqual(source.id, undefined);
});

test('isItemQueued/markItemQueued track a queued item by asset key across separate reads', () => {
    // The persistent half of the fix: readInventoryItems now returns a new object every
    // call, so a second "sell all"/"turn into gems" pass moments later gets a different
    // object for the same physical item and cannot see a `.queued` flag stamped on the
    // first one. This is where that flag lives instead.
    const first = see.flattenItem({ appid: 730, contextid: 2, description: {} }, '123');
    const second = see.flattenItem({ appid: 730, contextid: 2, description: {} }, '123');

    assert.strictEqual(see.isItemQueued(first), false);

    see.markItemQueued(first);

    assert.strictEqual(see.isItemQueued(first), true);
    assert.strictEqual(see.isItemQueued(second), true, 'the same asset key, a different object');
});

test('isItemQueued does not confuse two different items', () => {
    const itemA = see.flattenItem({ appid: 730, contextid: 2, description: {} }, '1');
    const itemB = see.flattenItem({ appid: 730, contextid: 2, description: {} }, '2');

    see.markItemQueued(itemA);

    assert.strictEqual(see.isItemQueued(itemA), true);
    assert.strictEqual(see.isItemQueued(itemB), false);
});
