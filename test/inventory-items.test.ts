import { test } from 'vitest';
import assert from 'node:assert';
import {
    duplicatesByClassId,
    flattenItem,
    getItemName,
    isItemQueued,
    markItemQueued,
    readInventoryItems,
} from '../src/items/index.ts';

// readInventoryItems is the one reader getInventoryItems (the inventory page) and
// getTradeOfferInventoryItems (the trade offer page) both call now, parameterised by the two
// property names Steam spells the same shape with on each page.

test('a missing active inventory answers an empty array, not a throw', () => {
    assert.deepStrictEqual(readInventoryItems(null, 'm_rgChildInventories', 'm_rgAssets'), []);
    assert.deepStrictEqual(readInventoryItems(undefined, 'rgChildInventories', 'rgInventory'), []);
});

test("flattens items out of child inventories, merging each one's own description", () => {
    const activeInventory = {
        m_rgChildInventories: {
            753: {
                m_rgAssets: {
                    123: {
                        appid: 753,
                        description: { name: 'Gems', tags: [] },
                    },
                },
            },
        },
    };

    const items = readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

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
                description: { name: 'Only item' },
            },
        },
    };

    const items = readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'Only item');
});

test('collects both child-inventory items and top-level items together', () => {
    const activeInventory = {
        m_rgChildInventories: {
            753: {
                m_rgAssets: {
                    1: { description: { name: 'From a child inventory' } },
                },
            },
        },
        m_rgAssets: {
            2: { description: { name: 'From the top level' } },
        },
    };

    const items = readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');
    const names = items.map((item) => item.name).sort();

    assert.deepStrictEqual(names, ['From a child inventory', 'From the top level']);
});

test('skips entries that are not objects', () => {
    // Steam's asset maps sometimes carry non-item metadata keys alongside the real assets.
    const activeInventory = {
        m_rgChildInventories: {},
        m_rgAssets: {
            length: 1,
            1: { description: { name: 'A real item' } },
        },
    };

    const items = readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'A real item');
});

test("the same reader works for the trade offer page's different property names", () => {
    const activeInventory = {
        rgChildInventories: {
            753: {
                rgInventory: {
                    1: { description: { name: 'Trade offer item' } },
                },
            },
        },
    };

    const items = readInventoryItems(activeInventory, 'rgChildInventories', 'rgInventory');

    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].name, 'Trade offer item');
});

test("does not mutate Steam's own inventory objects", () => {
    // readInventoryItems used to Object.assign the description straight onto Steam's own
    // item and stamp an id on it - a real mutation of an object Steam still owns. It
    // returns new objects now; the source is untouched.
    const steamOwnedItem: any = { appid: 730, description: { name: 'Gems' } };
    const activeInventory = {
        m_rgChildInventories: {},
        m_rgAssets: { 123: steamOwnedItem },
    };

    const items = readInventoryItems(activeInventory, 'm_rgChildInventories', 'm_rgAssets');

    assert.notStrictEqual(items[0], steamOwnedItem, 'a new object, not the same reference');
    assert.strictEqual(steamOwnedItem.name, undefined, "Steam's own item was never touched");
    assert.strictEqual(steamOwnedItem.id, undefined);
    assert.strictEqual(items[0].name, 'Gems', 'the returned copy is flattened, though');
});

test('flattenItem merges the description onto a new object without touching the source', () => {
    const source: any = { appid: 730, description: { name: 'Gems', tags: [] } };

    const item = flattenItem(source, '123');

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
    const first = flattenItem({ appid: 730, contextid: 2, description: {} }, '123');
    const second = flattenItem({ appid: 730, contextid: 2, description: {} }, '123');

    assert.strictEqual(isItemQueued(first), false);

    markItemQueued(first);

    assert.strictEqual(isItemQueued(first), true);
    assert.strictEqual(isItemQueued(second), true, 'the same asset key, a different object');
});

test('isItemQueued does not confuse two different items', () => {
    const itemA = flattenItem({ appid: 730, contextid: 2, description: {} }, '1');
    const itemB = flattenItem({ appid: 730, contextid: 2, description: {} }, '2');

    markItemQueued(itemA);

    assert.strictEqual(isItemQueued(itemA), true);
    assert.strictEqual(isItemQueued(itemB), false);
});

// getItemName -- the `item.name || item.description.name` idiom this codebase writes in six
// places, with the description dereference that used to throw when neither carried a name.
// Distinct from getMarketHashName: this answers what to show a user, not what to ask Steam.
test('getItemName prefers the top-level name', () => {
    assert.strictEqual(
        getItemName({ name: 'Sackboy', description: { name: 'Something Else' } }),
        'Sackboy',
    );
});

test('getItemName falls back to the description name', () => {
    assert.strictEqual(getItemName({ description: { name: 'Sackboy' } }), 'Sackboy');
});

test('getItemName falls back to the description name when the top-level name is empty', () => {
    assert.strictEqual(getItemName({ name: '', description: { name: 'Sackboy' } }), 'Sackboy');
});

test('getItemName is an empty string when the item carries no name at all', () => {
    assert.strictEqual(getItemName({ description: {} }), '');
});

// The dereference that threw: no description property at all.
test('getItemName is an empty string when the item has no description', () => {
    assert.strictEqual(getItemName({}), '');
});

test('getItemName is an empty string for a null item', () => {
    assert.strictEqual(getItemName(null), '');
});

// duplicatesByClassId -- what "duplicates" means to the sell and gem actions.
//
// This decides which items get sold, so identity with the previous implementation matters
// more than the speed does. `previousImplementation` below is that form verbatim; every
// assertion here is checked against both.
function previousImplementation(items: any[]): any[] {
    return items.filter((e, i) => items.map((m) => m.classid).indexOf(e.classid) !== i);
}

function bothAgree(items: any[]) {
    const now = duplicatesByClassId(items);

    assert.deepStrictEqual(
        now,
        previousImplementation(items),
        'the single-pass form must select exactly the items the O(n^2) form did',
    );

    return now;
}

test('duplicatesByClassId excludes the first occurrence and keeps every later one', () => {
    const a1 = { classid: 'a', id: '1' };
    const a2 = { classid: 'a', id: '2' };
    const a3 = { classid: 'a', id: '3' };
    const b1 = { classid: 'b', id: '4' };

    assert.deepStrictEqual(bothAgree([a1, a2, a3, b1]), [a2, a3]);
});

test('duplicatesByClassId returns nothing when every classid is unique', () => {
    assert.deepStrictEqual(bothAgree([{ classid: 'a' }, { classid: 'b' }, { classid: 'c' }]), []);
});

test('duplicatesByClassId preserves the order it was given', () => {
    const items = [
        { classid: 'a', id: '1' },
        { classid: 'b', id: '2' },
        { classid: 'a', id: '3' },
        { classid: 'b', id: '4' },
        { classid: 'a', id: '5' },
    ];

    assert.deepStrictEqual(
        bothAgree(items).map((item) => item.id),
        ['3', '4', '5'],
    );
});

// An absent classid is `undefined`, and a Set groups those together exactly as indexOf did.
test('duplicatesByClassId groups items with no classid together', () => {
    const first = { id: '1' };
    const second = { id: '2' };

    assert.deepStrictEqual(bothAgree([first, second]), [second]);
});

test('duplicatesByClassId is empty for an empty inventory', () => {
    assert.deepStrictEqual(bothAgree([]), []);
});

// The reason for the change: the previous form built a full-length array of classids per
// element. This is the size at which that stopped being free -- 213ms against 1ms when
// measured, and Steam inventories go well past it.
test('duplicatesByClassId agrees with the previous implementation on a large inventory', () => {
    const items = Array.from({ length: 5000 }, (_, i) => ({ classid: `c${i % 700}`, id: `${i}` }));

    const now = bothAgree(items);

    assert.strictEqual(now.length, 5000 - 700);
});
