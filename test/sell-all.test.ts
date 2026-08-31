// The four "sell all X" buttons, and which items each of them actually queues.
//
// They were the same eighteen lines four times over, differing only in a predicate, and are
// now one `sellWhere` plus four one-liners. Nothing covered them before, so these tests exist
// to say the collapse selects exactly the items the four hand-written copies did -- including
// the ordering inside sellAllDuplicateItems, which the task warns about: marketable first,
// then duplicates within that set.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import {
    itemQueue,
    sellAllCards,
    sellAllCrates,
    sellAllDuplicateItems,
    sellAllItems,
} from '../src/inventory/sell.ts';

// A card, a crate and a plain item, in the inventory-page shape (tags on the item itself).
function card(id: string, classid: string, marketable = 1) {
    return {
        appid: 753,
        contextid: '6',
        id,
        classid,
        marketable,
        tags: [{ category: 'item_class', internal_name: 'item_class_2' }],
    };
}

function crate(id: string, classid: string, marketable = 1) {
    return {
        appid: 730,
        contextid: '2',
        id,
        classid,
        marketable,
        tags: [{ category: 'Type', internal_name: 'Supply Crate' }],
    };
}

function plain(id: string, classid: string, marketable = 1) {
    return { appid: 440, contextid: '2', id, classid, marketable, tags: [] };
}

function setInventory(items: any[]) {
    const assets: Record<string, unknown> = {};
    items.forEach((item) => {
        assets[item.id] = item;
    });

    (globalThis as any).unsafeWindow.g_ActiveInventory.m_rgAssets = assets;
    (globalThis as any).unsafeWindow.g_ActiveInventory.m_rgChildInventories = {};
}

// What actually reached the sell queue.
let pushed: any[] = [];

// enqueueInventoryItems skips items already marked queued, and that registry is module-level
// state keyed on `appid_contextid_id` -- it deliberately outlives a single action, so an item
// queued by one button is not queued again by the next. Each test therefore gets its own id
// range rather than reusing 1..4, which would have every test after the first silently queue
// nothing.
let nextId = 100;

function ids(count: number): string[] {
    return Array.from({ length: count }, () => String(nextId++));
}

beforeEach(() => {
    pushed = [];
    (itemQueue as any).push = (item: any) => pushed.push(item);
    document.body.innerHTML = '';
});

function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

function queuedIds() {
    return pushed.map((item) => item.id).sort();
}

test('sellAllItems queues every marketable item and nothing else', async () => {
    const [a, b, c, d] = ids(4);
    setInventory([card(a, 'a'), crate(b, 'b'), plain(c, 'c'), plain(d, 'd', 0)]);

    sellAllItems();
    await flush();

    assert.deepStrictEqual(queuedIds(), [a, b, c].sort());
});

test('sellAllCards queues marketable trading cards only', async () => {
    const [a, b, c, d] = ids(4);
    setInventory([card(a, 'a'), card(b, 'b', 0), crate(c, 'c'), plain(d, 'd')]);

    sellAllCards();
    await flush();

    assert.deepStrictEqual(queuedIds(), [a]);
});

test('sellAllCrates queues marketable crates only', async () => {
    const [a, b, c, d] = ids(4);
    setInventory([crate(a, 'a'), crate(b, 'b', 0), card(c, 'c'), plain(d, 'd')]);

    sellAllCrates();
    await flush();

    assert.deepStrictEqual(queuedIds(), [a]);
});

test('sellAllDuplicateItems keeps one copy of each classid and queues the rest', async () => {
    const [a, b, c, d] = ids(4);
    setInventory([plain(a, 'x'), plain(b, 'x'), plain(c, 'x'), plain(d, 'y')]);

    sellAllDuplicateItems();
    await flush();

    assert.deepStrictEqual(queuedIds(), [b, c].sort(), 'the first of each classid is kept');
});

// The ordering the task warns about. With an unmarketable copy first, filtering to marketable
// *before* finding duplicates means the surviving marketable copy is the "first" occurrence
// and is kept. Finding duplicates first would make the unmarketable one the first occurrence
// and would queue a marketable copy the original left alone -- a different set of items sold.
test('sellAllDuplicateItems filters to marketable before finding duplicates', async () => {
    const [a, b, c] = ids(3);
    setInventory([plain(a, 'x', 0), plain(b, 'x'), plain(c, 'x')]);

    sellAllDuplicateItems();
    await flush();

    assert.deepStrictEqual(
        queuedIds(),
        [c],
        `${b} is the first *marketable* copy and is kept; reversing the order would queue it`,
    );
});

test('sellAllDuplicateItems queues nothing when every classid is unique', async () => {
    const [a, b, c] = ids(3);
    setInventory([plain(a, 'x'), plain(b, 'y'), plain(c, 'z')]);

    sellAllDuplicateItems();
    await flush();

    assert.deepStrictEqual(queuedIds(), []);
});
