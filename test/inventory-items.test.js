'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadUserscript } = require('./harness.js');

const see = loadUserscript();

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
