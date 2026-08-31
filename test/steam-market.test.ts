import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import { market } from '../src/steam/market.ts';
import { request } from '../src/net/request.ts';
import { storageSessionInstance } from '../src/storage/session.ts';

// What SteamMarket's methods report.
//
// Written first as characterisation tests, describing current behaviour including the parts
// that are wrong, so that each commit changing the convention shows up as a change in
// expectations rather than as new tests appearing beside a rewrite. Three of them still
// assert that a listing Steam rejected is reported as a success -- that is the defect, and
// it survives the arity pass untouched because that pass changed shape, not meaning. The
// commit that fixes it is the one that flips those three.
// See docs/adr/0002-steam-success-is-checked-on-sellitem-only.md.
//
// The seam is request()'s transport, which defaults to $.ajax and is re-read on every call,
// so replacing $.ajax for the duration of a test is enough. The methods themselves take no
// transport parameter.

// The sentinels as they stand (src/constants.ts:49-51). Written as literals rather than
// imported, because the point of these tests is to pin the values callers actually observe.
const ERROR_SUCCESS = null;
const ERROR_FAILED = 1;
const ERROR_DATA = 2;

// A jQuery-ajax-shaped settings object in, one canned response out. Same shape as the
// helper in request.test.ts; kept local so the two files can drift apart if they need to.
function respondWith(settings: any, response: any) {
    const xhr = { status: response.status ?? 200, responseText: response.responseText ?? '' };
    const statusText = response.statusText ?? (response.error ? 'error' : 'success');

    if (response.error) {
        settings.error(xhr, statusText, '');
    } else {
        settings.success(response.data, statusText, xhr);
    }

    settings.complete(xhr, statusText);
}

// Answers the next request with `response`, immediately.
function answerWith(response: any) {
    ($ as any).ajax = (settings: any) => respondWith(settings, response);
}

// A transport error. Status 500 deliberately: the breaker trips on 400/401/403/404/405/429,
// and tripping it is a one-way door that would break every later test in this file.
const transportError = { error: true, status: 500 };

// Records every callback invocation as its full argument list, so the tests can pin arity
// as well as values. Methods here used to call back with one argument where their siblings
// passed two; asserting on whole argument lists is what holds that closed.
function recorder() {
    const calls: any[][] = [];
    const fn = (...args: any[]) => {
        calls.push(args);
    };

    return Object.assign(fn, { calls });
}

// owner_actions is required: getGooValue iterates it to recover the gem appid, and does so
// outside any guard, so an item without it throws before the request is ever made.
const anItem = {
    appid: 730,
    contextid: '2',
    assetid: '123',
    amount: 1,
    market_fee_app: 730,
    owner_actions: [],
};

let realAjax: any;

beforeEach(() => {
    vi.useFakeTimers();

    realAjax = ($ as any).ajax;

    // request() keeps per-call state on the function object. Left alone it leaks between
    // tests: a pending flag from a previous test queues this test's request instead of
    // sending it.
    request.pending = false;
    request.queue = [];
    request.errors = 0;
});

afterEach(() => {
    ($ as any).ajax = realAjax;
    vi.useRealTimers();
});

// --- sellItem -------------------------------------------------------------------------
// The only method that passes request()'s callback straight through, so its callers see
// request()'s convention rather than SteamMarket's.

test('sellItem reports a listed item as (null, data)', () => {
    answerWith({ data: { success: true } });

    const cb = recorder();
    market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[null, { success: true }]]);
});

test('sellItem reports a listing Steam rejected as ERROR_DATA, keeping the message', () => {
    // A 200 carrying success:false means Steam declined to list the item. This used to be
    // reported as ERROR_SUCCESS, so market/relist.ts -- which asks only whether there was an
    // error -- painted the row green and removed the listing three seconds later, leaving
    // the item unlisted in the user's inventory.
    const message = 'You cannot sell any items until your previous action completes.';

    answerWith({ data: { success: false, message } });

    const cb = recorder();
    market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA, { success: false, message }]]);
});

test('sellItem reports a 200 with no success field as ERROR_DATA', () => {
    // Truthiness, not `success === false`: an absent field counts as refused. That matches
    // what inventory/sell.ts has read off this response for years.
    answerWith({ data: {} });

    const cb = recorder();
    market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA, {}]]);
});

test('sellItem reports a transport failure as (ERROR_FAILED, null)', () => {
    answerWith(transportError);

    const cb = recorder();
    market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    // This used to be request()'s own Error object, because sellItem forwarded request()'s
    // callback instead of reporting the way its siblings do. Both are truthy, which is why
    // swapping one for the other changed nothing at either call site.
    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED, null]]);
});

// --- removeListing --------------------------------------------------------------------

test('removeListing reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { ok: 1 } });

    const cb = recorder();
    market.removeListing('99', false, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { ok: 1 }]]);
});

test('removeListing reports a success:false body as ERROR_SUCCESS', () => {
    // Pinned, not endorsed. Whether this endpoint ever sends success:false is unknown --
    // no version of this codebase has ever read the field here. See ADR-0002.
    answerWith({ data: { success: false } });

    const cb = recorder();
    market.removeListing('99', false, cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
});

test('removeListing reports a transport failure as (ERROR_FAILED, null)', () => {
    answerWith(transportError);

    const cb = recorder();
    market.removeListing('99', false, cb);
    vi.advanceTimersByTime(0);

    // Passed one argument here and two in getGooValue, for the same kind of failure, until
    // the arity was normalised.
    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED, null]]);
});

// --- getGooValue ----------------------------------------------------------------------

test('getGooValue reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { goo_value: '12' } });

    const cb = recorder();
    market.getGooValue(anItem, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { goo_value: '12' }]]);
});

test('getGooValue reports a transport failure as (ERROR_FAILED, null)', () => {
    answerWith(transportError);

    const cb = recorder();
    market.getGooValue(anItem, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED, null]]);
});

test('getGooValue reports a missing owner_actions as ERROR_FAILED, without requesting', () => {
    // The method's try/catch turns a thrown TypeError into the same sentinel a network
    // failure produces, with no second argument and no log. A caller cannot tell the two
    // apart, and this path never reaches Steam at all.
    let requested = false;
    ($ as any).ajax = () => {
        requested = true;
    };

    const cb = recorder();
    market.getGooValue({ ...anItem, owner_actions: undefined }, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED, null]]);
    assert.strictEqual(requested, false);
});

// --- grindIntoGoo ---------------------------------------------------------------------

test('grindIntoGoo reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { ok: 1 } });

    const cb = recorder();
    market.grindIntoGoo(anItem, 12, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { ok: 1 }]]);
});

test('grindIntoGoo reports a success:false body as ERROR_SUCCESS', () => {
    answerWith({ data: { success: false, message: 'nope' } });

    const cb = recorder();
    market.grindIntoGoo(anItem, 12, cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
});

// --- unpackBoosterPack ----------------------------------------------------------------

test('unpackBoosterPack reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { ok: 1 } });

    const cb = recorder();
    market.unpackBoosterPack(anItem, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { ok: 1 }]]);
});

test('unpackBoosterPack reports a success:false body as ERROR_SUCCESS', () => {
    answerWith({ data: { success: false, message: 'nope' } });

    const cb = recorder();
    market.unpackBoosterPack(anItem, cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
});

// --- the read methods -----------------------------------------------------------------
// These two already do what the mutating methods do not: they read Steam's success field
// and report ERROR_DATA when it says no. Pinned so that routing them through a shared
// helper can be shown to change nothing.

test('getCurrentPriceHistory reports a success:false body as ERROR_DATA', () => {
    answerWith({ data: { success: false } });

    const cb = recorder();
    market.getCurrentPriceHistory(730, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA, null, false]]);
});

// A 200 with an empty or null JSON body. `responseType: 'json'` yields `null` for that,
// which the old `if (data && ...)` guard skipped -- so the loop below it dereferenced null
// and threw. The throw happens inside request()'s setTimeout, so it escaped as an uncaught
// timer exception and no callback ran at all: runQueue's next() was never called and the
// concurrency-1 pricing queue was dead for the rest of the page's life. This test fails with
// a TypeError on the old guard, which is the point of it.
test('getCurrentPriceHistory reports a null body as ERROR_DATA rather than throwing', () => {
    answerWith({ data: null });

    const cb = recorder();
    market.getCurrentPriceHistory(730, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA, null, false]]);
});

test('getCurrentPriceHistory reports prices in pennies, uncached', () => {
    answerWith({ data: { success: true, prices: [['1 Jan 2026 01: +0', 1.5, '3']] } });

    const cb = recorder();
    market.getCurrentPriceHistory(730, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, [['1 Jan 2026 01: +0', 150, 3]], false]]);
});

test('getCurrentOrderBook reports an unusable body as (ERROR_DATA, null, false)', () => {
    answerWith({ data: {} });

    const cb = recorder();
    market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA, null, false]]);
});

test('getCurrentOrderBook reports a transport failure as (ERROR_FAILED, null, false)', () => {
    answerWith(transportError);

    const cb = recorder();
    market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    // The read methods omitted their third argument entirely when they failed, so callers
    // that destructure `cached` got undefined. Both are falsy, which is why nextQueueStep
    // -- whose only uses are `!cached` and `cached ? 0 : delay` -- cannot tell them apart.
    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED, null, false]]);
});

// --- the order book cache -------------------------------------------------------------
//
// Order books are cached for the browsing session (src/storage/session.ts), so whatever is
// written here is what every later page load in the tab prices against. A body carrying a
// buy side and no sell side is a real answer from Steam -- it is what an item with no sell
// listings looks like, including the gap between a listing being created and the histogram
// catching up with it -- but it is a transient one, and caching it pins a whole session to a
// state that has already passed.

test('getCurrentOrderBook caches an order book that has a sell side', () => {
    const cached = vi.spyOn(storageSessionInstance(), 'setItem');
    answerWith({
        data: {
            data: {
                success: true,
                data: {
                    amtMaxBuyOrder: 92,
                    amtMinSellOrder: 187,
                    rgCompactBuyOrders: [92, 1],
                    rgCompactSellOrders: [187, 1],
                },
            },
        },
    });

    const cb = recorder();
    market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls.length, 1);
    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
    assert.strictEqual(cb.calls[0][1].lowest_sell_order, 187);
    assert.strictEqual(cached.mock.calls.length, 1, 'a usable order book is cached');

    cached.mockRestore();
});

test('getCurrentOrderBook reports an order book with no sell side without caching it', () => {
    const cached = vi.spyOn(storageSessionInstance(), 'setItem');
    answerWith({
        data: {
            data: { success: true, data: { amtMaxBuyOrder: 92, rgCompactBuyOrders: [92, 1] } },
        },
    });

    const cb = recorder();
    market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls.length, 1);
    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS, 'still a successful answer');
    assert.strictEqual(cb.calls[0][1].highest_buy_order, 92, 'and still reported to the caller');
    assert.strictEqual(
        cached.mock.calls.length,
        0,
        'but not cached, so the next page load asks Steam again',
    );

    cached.mockRestore();
});

// --- a cache write that fails ------------------------------------------------------------
//
// localforage rejects when the browser refuses site data or the quota is exceeded. These two
// writes happen inside an ajax callback with nothing above them to catch that, so an
// uncaught rejection was both an unhandled rejection in the console and the caching silently
// stopping with no explanation.
//
// Failing to cache is not failing to price: the callback must still fire, with the same
// values, which is what the first two pin. Nothing here awaits the write -- turning it into
// an await would make a refused cache delay every price.
//
// Those two pass on the uncaught version as well, because the callback always fired; what was
// missing was the handler. So `trackedSetItem` pins the handler itself: it returns a thenable
// that records whether anything attached to it, which is false exactly when the rejection
// would escape.

function trackedSetItem() {
    const state = { handled: false };
    const spy = vi.spyOn(storageSessionInstance(), 'setItem').mockReturnValue({
        catch(onRejected: (e: unknown) => unknown) {
            state.handled = true;

            return Promise.resolve(onRejected(new Error('site data is disabled')));
        },
    } as any);

    return { state, restore: () => spy.mockRestore() };
}

test('the price-history cache write has a rejection handler attached', () => {
    const tracked = trackedSetItem();
    answerWith({ data: { success: true, prices: [['1 Jan 2026 01: +0', 1.5, '3']] } });

    market.getCurrentPriceHistory(730, 'Some Item', recorder());
    vi.advanceTimersByTime(0);

    assert.strictEqual(
        tracked.state.handled,
        true,
        'an uncaught localforage rejection escapes an ajax callback with nothing above it',
    );

    tracked.restore();
});

test('the order-book cache write has a rejection handler attached', () => {
    const tracked = trackedSetItem();
    answerWith({
        data: {
            data: {
                success: true,
                data: {
                    amtMaxBuyOrder: 92,
                    amtMinSellOrder: 187,
                    rgCompactBuyOrders: [92, 1],
                    rgCompactSellOrders: [187, 1],
                },
            },
        },
    });

    market.getCurrentOrderBook(anItem, 'Some Item', recorder());
    vi.advanceTimersByTime(0);

    assert.strictEqual(tracked.state.handled, true);

    tracked.restore();
});

test('a rejecting price-history cache write still reports the prices', () => {
    const failing = vi
        .spyOn(storageSessionInstance(), 'setItem')
        .mockRejectedValue(new Error('site data is disabled'));
    answerWith({ data: { success: true, prices: [['1 Jan 2026 01: +0', 1.5, '3']] } });

    const cb = recorder();
    market.getCurrentPriceHistory(730, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, [['1 Jan 2026 01: +0', 150, 3]], false]]);

    failing.mockRestore();
});

test('a rejecting order-book cache write still reports the order book', () => {
    const failing = vi
        .spyOn(storageSessionInstance(), 'setItem')
        .mockRejectedValue(new Error('site data is disabled'));
    answerWith({
        data: {
            data: {
                success: true,
                data: {
                    amtMaxBuyOrder: 92,
                    amtMinSellOrder: 187,
                    rgCompactBuyOrders: [92, 1],
                    rgCompactSellOrders: [187, 1],
                },
            },
        },
    });

    const cb = recorder();
    market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls.length, 1);
    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
    assert.strictEqual(cb.calls[0][1].lowest_sell_order, 187);

    failing.mockRestore();
});
