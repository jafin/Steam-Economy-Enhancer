// Characterisation of the pricing preamble shared by the three queue workers TASK-14
// extracts: itemQueueWorker (src/inventory/sell.ts), inventoryPriceQueueWorker
// (src/inventory/data.ts) and marketListingsQueueWorker (src/market/listings.ts). Each
// asks Steam for an item's price history and/or order book, counts requests that reached
// Steam and failed, and reports back (success, cached) -- cached being the AND of both
// answers' cache flags for the two workers that fetch both, and just the order book's flag
// for data.ts, which never asks for history at all (see data.ts:70).
//
// Written against the code as it stands after the dead-guard removal and before the
// fetchPricingInputs extraction, so these pin what step 3 must not change.

import { afterEach, beforeEach, test, vi } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import List from 'list.js';
import { itemQueueWorker, sellQueue } from '../src/inventory/sell.ts';
import { inventoryPriceQueueWorker } from '../src/inventory/data.ts';
import { marketListingsQueueWorker } from '../src/market/listings.ts';
import { marketLists } from '../src/market/rows.ts';
import { storageSessionInstance } from '../src/storage/session.ts';

// A routed stand-in for $.ajax, keyed by URL substring rather than call order -- the
// preamble fires the history and order book requests as two independent request() calls,
// queued one behind the other by request()'s own one-at-a-time policy (see net/request.ts),
// not necessarily in a fixed order once retries or failures are involved.
function installRoutedAjax(routes: { match: string; data?: any; fail?: boolean }[]) {
    const calls: string[] = [];

    ($ as any).ajax = (settings: any) => {
        calls.push(settings.url);

        const route = routes.find((r) => settings.url.includes(r.match));
        const xhr = { status: route && !route.fail ? 200 : 500, responseText: '' };

        if (route && !route.fail) {
            settings.success(route.data, 'success', xhr);
        } else {
            settings.error(xhr, 'error', '');
        }

        settings.complete(xhr, route && !route.fail ? 'success' : 'error');

        return { done: () => undefined, fail: () => undefined, always: () => undefined };
    };

    return calls;
}

// A price history response with nothing in it -- calculateAverageHistoryPriceBeforeFees
// copes with an empty array, and the preamble does not care what the numbers are.
const historyResponse = { success: true, prices: [] };

// An order book response buildOrderBook (steam/market.ts) accepts. getCurrentOrderBook
// passes `data?.data` into buildOrderBook, and buildOrderBook itself reads `.success` and
// `.data` off what it is given -- so the payload Steam actually sends is double-nested:
// the ajax body's `.data` is `{ success, data: {...} }`, and it is that inner `.data` that
// carries amtMinSellOrder and friends.
const orderBookResponse = {
    data: {
        success: true,
        data: {
            amtMinSellOrder: '100',
            amtMaxBuyOrder: '80',
            rgCompactBuyOrders: [],
            rgCompactSellOrders: [],
        },
    },
};

let realAjax: any;

beforeEach(async () => {
    vi.useFakeTimers();
    realAjax = ($ as any).ajax;

    // request() keeps per-call state on the function object; left alone it leaks between
    // tests the same way steam-market.test.ts guards against.
    const { request } = await import('../src/net/request.ts');
    request.pending = false;
    request.queue = [];
    request.errors = 0;

    await storageSessionInstance().clear();
});

afterEach(() => {
    ($ as any).ajax = realAjax;
    sellQueue.kill();
    marketLists.length = 0;
    document.body.innerHTML = '';
    vi.useRealTimers();
});

// Runs the preamble to completion: two sequential market-prefixed requests, each delayed
// by REQUEST_DELAY_MARKET (net/request.ts), plus whatever localforage takes to answer the
// cache read that precedes them. Generous on purpose -- this is about flushing the chain,
// not timing it.
async function flush() {
    await vi.advanceTimersByTimeAsync(10000);
}

function recorder() {
    const calls: any[][] = [];
    return Object.assign((...args: any[]) => calls.push(args), { calls });
}

//#region itemQueueWorker (sell.ts) -- history + order book
const sellItem = (suffix: string) => ({
    id: `1${suffix}`,
    assetid: `1${suffix}`,
    appid: 730,
    contextid: '2',
    amount: 1,
    description: { market_hash_name: `Sell Item ${suffix}`, name: `Sell Item ${suffix}` },
});

test('itemQueueWorker: both requests succeed reports (true, not cached)', async () => {
    installRoutedAjax([
        { match: '/market/pricehistory/', data: historyResponse },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);

    const cb = recorder();
    itemQueueWorker(sellItem('a'), false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[true, false]]);
});

test('itemQueueWorker: history fails and ignoreErrors is false reports (false, not cached)', async () => {
    installRoutedAjax([
        { match: '/market/pricehistory/', fail: true },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);

    const cb = recorder();
    itemQueueWorker(sellItem('b'), false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[false, false]]);
});

test('itemQueueWorker: both answers are cached reports (true, cached), without asking Steam again', async () => {
    const calls = installRoutedAjax([
        { match: '/market/pricehistory/', data: historyResponse },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);
    // A successful pass also pushes the priced item onto sellQueue, which -- on its own
    // schedule -- goes on to call market.sellItem and so /market/sellitem/. Irrelevant to
    // the preamble this test pins, so only the pricing requests are counted below.
    const pricingCalls = () =>
        calls.filter(
            (url) => url.includes('/market/pricehistory/') || url.includes('/market/orderbook'),
        ).length;

    const item = sellItem('c');

    itemQueueWorker(item, false, recorder());
    await flush();

    const pricingCallsAfterFirstPass = pricingCalls();

    const cb = recorder();
    itemQueueWorker(item, false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[true, true]]);
    assert.strictEqual(
        pricingCalls(),
        pricingCallsAfterFirstPass,
        'a cached pass must not ask Steam again',
    );
});
//#endregion

//#region inventoryPriceQueueWorker (data.ts) -- order book only
const priceItem = (suffix: string) => ({
    id: `2${suffix}`,
    assetid: `2${suffix}`,
    appid: 440,
    contextid: '2',
    amount: 1,
    description: { market_hash_name: `Price Item ${suffix}`, name: `Price Item ${suffix}` },
});

test('inventoryPriceQueueWorker: the order book succeeds reports (true, not cached)', async () => {
    const calls = installRoutedAjax([{ match: '/market/orderbook', data: orderBookResponse }]);

    const cb = recorder();
    inventoryPriceQueueWorker(priceItem('a'), false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[true, false]]);
    // The history is not important to visualize the current prices (data.ts:70) -- pin
    // that this path never asks for it, or every priced inventory item costs Steam an
    // extra request.
    assert.ok(
        !calls.some((url) => url.includes('/market/pricehistory/')),
        'inventoryPriceQueueWorker must not fetch price history',
    );
});

test('inventoryPriceQueueWorker: the order book fails and ignoreErrors is false reports (false, not cached)', async () => {
    installRoutedAjax([{ match: '/market/orderbook', fail: true }]);

    const cb = recorder();
    inventoryPriceQueueWorker(priceItem('b'), false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[false, false]]);
});

test('inventoryPriceQueueWorker: the order book is cached reports (true, cached), without asking Steam again', async () => {
    const calls = installRoutedAjax([{ match: '/market/orderbook', data: orderBookResponse }]);

    const item = priceItem('c');

    inventoryPriceQueueWorker(item, false, recorder());
    await flush();

    const callsAfterFirstPass = calls.length;

    const cb = recorder();
    inventoryPriceQueueWorker(item, false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[true, true]]);
    assert.strictEqual(calls.length, callsAfterFirstPass, 'a cached pass must not ask Steam again');
});
//#endregion

//#region marketListingsQueueWorker (listings.ts) -- history + order book
// Matches the shape addMarketListings() (src/market/listings.ts) builds a row into, plus
// the nested spans marketListingsQueueWorker itself reads: the listed/net price at
// '.market_listing_price > span:nth-child(1) > span:nth-child(1|3)' (see the comment above
// renderPriceCellGrid), inside a '.market_listing_my_price' cell. The empty
// '.market_listing_cancel_button' is Steam's Remove column, which renderVolumeCell writes
// the day's sales volume into.
function registerListing(listingId: string, appid: number, assetid: string) {
    const containerId = `market-${listingId}`;

    document.body.innerHTML += `
        <div id="${containerId}">
            <div class="list">
                <div class="market_listing_row">
                    <span class="market_listing_item_name" id="mylisting_${listingId}_name"></span>
                    <div class="market_listing_cancel_button"></div>
                    <div class="market_listing_my_price">
                        <span class="market_listing_price">
                            <span>
                                <span>1,00€</span>
                                <span> ➤ </span>
                                <span>(0,80€)</span>
                            </span>
                        </span>
                    </div>
                </div>
            </div>
        </div>`;

    const list = new List(containerId, {
        valueNames: [{ name: 'market_listing_item_name', attr: 'id' }],
    });
    marketLists.push(list);

    (globalThis as any).unsafeWindow.g_rgAssets[appid] ??= {};
    (globalThis as any).unsafeWindow.g_rgAssets[appid]['2'] ??= {};
    (globalThis as any).unsafeWindow.g_rgAssets[appid]['2'][assetid] = {
        type: 'A Game',
        name: `Listing ${listingId}`,
        description: { market_hash_name: `Listing ${listingId}` },
    };

    return { listingid: listingId, appid, contextid: '2', assetid };
}

test('marketListingsQueueWorker: both requests succeed reports (true, not cached)', async () => {
    installRoutedAjax([
        { match: '/market/pricehistory/', data: historyResponse },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);

    const listing = registerListing('111', 730, '9001');

    const cb = recorder();
    marketListingsQueueWorker(listing, false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[true, false]]);
});

test('marketListingsQueueWorker: a priced row gets the liquidity grid in its Remove column', async () => {
    // The wiring, end to end: the worker hands renderListingStats the same history and order
    // book it priced the row against. historyResponse carries no sales -- Steam saying the
    // item did not sell, a real zero rather than an unknown -- and the order book has no sell
    // side, so the queue is a real zero too and the estimate has no rate to divide by.
    installRoutedAjax([
        { match: '/market/pricehistory/', data: historyResponse },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);

    const listing = registerListing('999', 730, '9009');

    marketListingsQueueWorker(listing, false, recorder());
    await flush();

    const row = $(`#mylisting_999_name`).closest('.market_listing_row');
    const quadrants = $('.see_stats_grid .see_grid_cell', row)
        .toArray()
        .map((el) => [$('.see_grid_label', el).text(), $('.see_grid_value', el).text()]);

    assert.deepStrictEqual(quadrants, [
        ['24h sold', '0'],
        ['Queue', '0'],
        ['30d avg', '0'],
        ['Est sell', '—'],
    ]);
});

test('marketListingsQueueWorker: history fails and ignoreErrors is false reports (false, not cached)', async () => {
    installRoutedAjax([
        { match: '/market/pricehistory/', fail: true },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);

    const listing = registerListing('222', 730, '9002');

    const cb = recorder();
    marketListingsQueueWorker(listing, false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[false, false]]);
});

test('marketListingsQueueWorker: both answers are cached reports (true, cached), without asking Steam again', async () => {
    const calls = installRoutedAjax([
        { match: '/market/pricehistory/', data: historyResponse },
        { match: '/market/orderbook', data: orderBookResponse },
    ]);

    const listing = registerListing('333', 730, '9003');

    marketListingsQueueWorker(listing, false, recorder());
    await flush();

    const callsAfterFirstPass = calls.length;

    const cb = recorder();
    marketListingsQueueWorker(listing, false, cb);
    await flush();

    assert.deepStrictEqual(cb.calls, [[true, true]]);
    assert.strictEqual(calls.length, callsAfterFirstPass, 'a cached pass must not ask Steam again');
});
//#endregion
