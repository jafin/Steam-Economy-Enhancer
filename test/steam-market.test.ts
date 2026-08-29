import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import * as see from '../src/main.ts';
import type { RequestError } from '../src/main.ts';

// What SteamMarket's methods report today, pinned before the result convention changes.
//
// These are characterisation tests: they describe current behaviour, including the parts
// that are wrong. Three of them assert that a listing Steam rejected is reported as a
// success -- that is the defect, written down deliberately so the commit that fixes it
// shows up as a change in expectations rather than as new tests appearing from nowhere.
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

// Records every callback invocation as its full argument list, so the tests can pin arity.
// Several methods call back with one argument where their siblings pass two, and that
// inconsistency is part of what is being characterised.
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
    see.request.pending = false;
    see.request.queue = [];
    see.request.errors = 0;
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
    see.market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[null, { success: true }]]);
});

test('sellItem reports a listing Steam REJECTED as (null, data) -- the defect', () => {
    // A 200 carrying success:false means Steam declined to list the item. sellItem does not
    // look at the body, so the error argument is null and every caller that only checks it
    // -- market/relist.ts:135 -- treats the rejection as a completed sale.
    answerWith({
        data: {
            success: false,
            message: 'You cannot sell any items until your previous action completes.',
        },
    });

    const cb = recorder();
    see.market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls[0][0], null);
    assert.strictEqual(cb.calls[0][1].success, false);
});

test('sellItem passes request()s Error through on a transport failure', () => {
    answerWith(transportError);

    const cb = recorder();
    see.market.sellItem(anItem, 100, cb);
    vi.advanceTimersByTime(0);

    // Not ERROR_FAILED -- an actual Error object, which is what makes this method's
    // convention different from every other one on the prototype.
    const error = cb.calls[0][0] as RequestError;

    assert.ok(error instanceof Error);
    assert.strictEqual(error.statusCode, 500);
    assert.strictEqual(cb.calls[0][1], null);
});

// --- removeListing --------------------------------------------------------------------

test('removeListing reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { ok: 1 } });

    const cb = recorder();
    see.market.removeListing('99', false, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { ok: 1 }]]);
});

test('removeListing reports a success:false body as ERROR_SUCCESS', () => {
    // Pinned, not endorsed. Whether this endpoint ever sends success:false is unknown --
    // no version of this codebase has ever read the field here. See ADR-0002.
    answerWith({ data: { success: false } });

    const cb = recorder();
    see.market.removeListing('99', false, cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
});

test('removeListing reports a transport failure as ERROR_FAILED, with no second argument', () => {
    answerWith(transportError);

    const cb = recorder();
    see.market.removeListing('99', false, cb);
    vi.advanceTimersByTime(0);

    // One argument, where getGooValue passes two on the same kind of failure.
    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED]]);
});

// --- getGooValue ----------------------------------------------------------------------

test('getGooValue reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { goo_value: '12' } });

    const cb = recorder();
    see.market.getGooValue(anItem, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { goo_value: '12' }]]);
});

test('getGooValue reports a transport failure as (ERROR_FAILED, null)', () => {
    answerWith(transportError);

    const cb = recorder();
    see.market.getGooValue(anItem, cb);
    vi.advanceTimersByTime(0);

    // Two arguments here, one in removeListing above. Same failure, different arity.
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
    see.market.getGooValue({ ...anItem, owner_actions: undefined }, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED]]);
    assert.strictEqual(requested, false);
});

// --- grindIntoGoo ---------------------------------------------------------------------

test('grindIntoGoo reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { ok: 1 } });

    const cb = recorder();
    see.market.grindIntoGoo(anItem, 12, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { ok: 1 }]]);
});

test('grindIntoGoo reports a success:false body as ERROR_SUCCESS', () => {
    answerWith({ data: { success: false, message: 'nope' } });

    const cb = recorder();
    see.market.grindIntoGoo(anItem, 12, cb);
    vi.advanceTimersByTime(0);

    assert.strictEqual(cb.calls[0][0], ERROR_SUCCESS);
});

// --- unpackBoosterPack ----------------------------------------------------------------

test('unpackBoosterPack reports success as (ERROR_SUCCESS, data)', () => {
    answerWith({ data: { ok: 1 } });

    const cb = recorder();
    see.market.unpackBoosterPack(anItem, cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, { ok: 1 }]]);
});

test('unpackBoosterPack reports a success:false body as ERROR_SUCCESS', () => {
    answerWith({ data: { success: false, message: 'nope' } });

    const cb = recorder();
    see.market.unpackBoosterPack(anItem, cb);
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
    see.market.getCurrentPriceHistory(730, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA]]);
});

test('getCurrentPriceHistory reports prices in pennies, uncached', () => {
    answerWith({ data: { success: true, prices: [['1 Jan 2026 01: +0', 1.5, '3']] } });

    const cb = recorder();
    see.market.getCurrentPriceHistory(730, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_SUCCESS, [['1 Jan 2026 01: +0', 150, 3]], false]]);
});

test('getCurrentOrderBook reports an unusable body as (ERROR_DATA, null)', () => {
    answerWith({ data: {} });

    const cb = recorder();
    see.market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_DATA, null]]);
});

test('getCurrentOrderBook reports a transport failure as (ERROR_FAILED, null)', () => {
    answerWith(transportError);

    const cb = recorder();
    see.market.getCurrentOrderBook(anItem, 'Some Item', cb);
    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(cb.calls, [[ERROR_FAILED, null]]);
});
