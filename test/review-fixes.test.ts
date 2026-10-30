// Faults a whole-project code review found, each pinned where it was verified.
//
// They live together because they have nothing else in common: a relist that lost a listing's
// quantity, a grind sent without a gem value, a pricing worker that stalled its queue, an
// inventory label that read infinity, and a quick-sell button that listed for a cent.

import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import List from 'list.js';
import { ERROR_SUCCESS } from '../src/constants.ts';
import { inventoryPriceQueueWorker } from '../src/inventory/data.ts';
import { scrapQueueWorker } from '../src/inventory/gems.ts';
import { quickSellPanel } from '../src/inventory/ui.ts';
import { marketListingsQueueWorker } from '../src/market/listings.ts';
import { listingState } from '../src/market/listingState.ts';
import { marketOverpricedQueue, queueOverpricedItemListing } from '../src/market/relist.ts';
import { marketLists } from '../src/market/rows.ts';
import { market } from '../src/steam/market.ts';
import { storageSessionInstance } from '../src/storage/session.ts';

function recorder() {
    const calls: any[][] = [];

    return Object.assign((...args: any[]) => calls.push(args), { calls });
}

beforeEach(async () => {
    const { request } = await import('../src/net/request.ts');
    request.pending = false;
    request.queue = [];
    request.errors = 0;

    await storageSessionInstance().clear();
    localStorage.clear();
});

afterEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// --- quick-sell ladder ----------------------------------------------------------------------

test('an absent order is not offered as a 0.00 quick-sell price', () => {
    // buildOrderBook writes a missing order as 0. A 0 button listed for the 1-cent floor.
    const panel = quickSellPanel(
        { highest_buy_order: 0, lowest_sell_order: 0 },
        (cents: number) => `$${(cents / 100).toFixed(2)}`,
    );

    assert.deepStrictEqual(panel.prices, []);
});

test('a real price survives next to an absent one', () => {
    const panel = quickSellPanel(
        { highest_buy_order: 0, lowest_sell_order: 500 },
        (cents: number) => `$${(cents / 100).toFixed(2)}`,
    );

    assert.deepStrictEqual(panel.prices, [499, 500]);
});

// --- gems -----------------------------------------------------------------------------------

test('an item is not ground into gems when the answer carries no gem value', () => {
    const realGet = market.getGooValue;
    const realGrind = market.grindIntoGoo;
    const grinds: any[] = [];

    // A 200 with a null body: ERROR_SUCCESS, no data.
    (market as any).getGooValue = (_item: any, callback: any) => callback(ERROR_SUCCESS, null);
    (market as any).grindIntoGoo = (...args: any[]) => grinds.push(args);

    try {
        const cb = recorder();

        assert.doesNotThrow(() =>
            scrapQueueWorker(
                { id: '1', appid: 753, contextid: '6', name: 'Card', market_fee_app: 1 },
                false,
                cb,
            ),
        );

        assert.deepStrictEqual(cb.calls, [[false]], 'the task fails rather than throwing');
        assert.strictEqual(grinds.length, 0, 'and nothing irreversible is sent to Steam');
    } finally {
        (market as any).getGooValue = realGet;
        (market as any).grindIntoGoo = realGrind;
    }
});

// --- pricing worker -------------------------------------------------------------------------

test('marketListingsQueueWorker finishes the task when the page does not hold the asset', () => {
    // Nothing in g_rgAssets for this id. The worker used to read asset.type and throw, which
    // never reached `done` and stalled the one-at-a-time queue.
    document.body.innerHTML = `
        <div id="market-77"><div class="list">
            <div class="market_listing_row">
                <span class="market_listing_item_name" id="mylisting_77_name"></span>
            </div>
        </div></div>`;
    marketLists.push(
        new List('market-77', {
            valueNames: [{ name: 'market_listing_item_name', attr: 'id' }],
        }),
    );

    const cb = recorder();

    assert.doesNotThrow(() =>
        marketListingsQueueWorker(
            { listingid: '77', appid: 730, contextid: '2', assetid: 'missing' },
            false,
            cb,
        ),
    );
    assert.deepStrictEqual(cb.calls, [[true, true]]);
});

// --- inventory price labels -----------------------------------------------------------------

test('inventory labels under the history-only algorithm show the lowest listing, not infinity', async () => {
    vi.useFakeTimers();
    localStorage.setItem('SETTING_PRICE_ALGORITHM', '4');

    const realAjax = ($ as any).ajax;
    ($ as any).ajax = (settings: any) => {
        const xhr = { status: 200, responseText: '' };

        settings.success(
            {
                data: {
                    success: true,
                    data: {
                        amtMinSellOrder: '100',
                        amtMaxBuyOrder: '80',
                        rgCompactBuyOrders: [],
                        rgCompactSellOrders: [100, 5],
                    },
                },
            },
            'success',
            xhr,
        );
        settings.complete(xhr, 'success');

        return { done: () => undefined, fail: () => undefined, always: () => undefined };
    };

    try {
        const item = {
            id: '5001',
            assetid: '5001',
            appid: 440,
            contextid: '2',
            amount: 1,
            description: { market_hash_name: 'Label Item', name: 'Label Item' },
        };

        document.body.innerHTML = `<div id="440_2_5001"></div>`;
        inventoryPriceQueueWorker(item, false, recorder());
        await vi.advanceTimersByTimeAsync(10000);

        const label = $('#440_2_5001 .inventory_item_price').text();

        assert.notStrictEqual(label, '∞');
        assert.ok(label.length > 0, 'a price is shown');
        assert.ok((listingState.get('440_2_5001')?.sellPrice ?? 0) > 0);
    } finally {
        ($ as any).ajax = realAjax;
    }
});

// --- relist ---------------------------------------------------------------------------------

test('a relist keeps the quantity of the listing it replaces', () => {
    document.body.innerHTML = `
        <div id="market-88"><div class="list">
            <div class="market_listing_row">
                <span class="market_listing_item_name" id="mylisting_88_name"></span>
                <a class="item_market_action_button" href="javascript:RemoveMarketListing('mylisting', '88', 730, '2', '9100')">Remove</a>
                <div class="market_listing_price"><span><span>1,00€</span><span> ➤ </span><span>(0,80€)</span></span></div>
            </div>
        </div></div>`;
    marketLists.push(
        new List('market-88', {
            valueNames: [{ name: 'market_listing_item_name', attr: 'id' }],
        }),
    );

    (globalThis as any).unsafeWindow.g_rgAssets[730] ??= {};
    (globalThis as any).unsafeWindow.g_rgAssets[730]['2'] ??= {};
    (globalThis as any).unsafeWindow.g_rgAssets[730]['2']['9100'] = { amount: '3' };

    listingState.set('88', { sellPrice: 80 });

    const pushed: any[] = [];
    const realPush = marketOverpricedQueue.push;
    (marketOverpricedQueue as any).push = (task: any) => pushed.push(task);

    try {
        queueOverpricedItemListing('88');
    } finally {
        (marketOverpricedQueue as any).push = realPush;
    }

    assert.strictEqual(pushed.length, 1);
    assert.strictEqual(pushed[0].amount, 3);
});
