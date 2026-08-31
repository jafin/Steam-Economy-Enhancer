// The liquidity arithmetic: what sold, what sells per day, how many listings are ahead of
// this one, and the estimate the last two produce.
//
// The recurring thing worth pinning across all of it is the null/zero distinction. Null means
// "not known" -- the history was never fetched, or the order book could not be read -- and
// zero is Steam answering that nothing sold. Collapsing the two would invent figures about
// someone's listing, so every function here keeps them apart and every formatter renders null
// as a dash.

import { test } from 'vitest';
import assert from 'node:assert';
import {
    RATE_FALLBACK_WINDOW_HOURS,
    RATE_WINDOW_HOURS,
    VOLUME_WINDOW_HOURS,
    daysToSell,
    formatDaysToSell,
    formatSalesRate,
    listingsAtOrBelow,
    queueAheadOf,
    salesRate,
    salesVolume,
    sellSpeedOf,
} from '../src/pricing/liquidity.ts';
import { formatCount } from '../src/util/numbers.ts';

const NOW = Date.UTC(2026, 7, 31, 12, 0, 0);

function hoursAgo(n: number): string {
    return new Date(NOW - n * 60 * 60 * 1000).toUTCString();
}

// [date, price in pennies, quantity] -- the shape getCurrentPriceHistory hands on, after it
// has multiplied the price and parsed the quantity.
function entry(hours: number, quantity: number) {
    return [hoursAgo(hours), 730, quantity];
}

test('the volume window is a day', () => {
    assert.strictEqual(VOLUME_WINDOW_HOURS, 24);
});

test('sums the quantities inside the window', () => {
    const history = [entry(20, 3), entry(10, 7), entry(1, 4)];

    assert.strictEqual(salesVolume(history, { now: NOW }), 14);
});

test('leaves out entries older than the window', () => {
    const history = [entry(48, 500), entry(25, 100), entry(23, 6)];

    assert.strictEqual(salesVolume(history, { now: NOW }), 6);
});

test('an explicit window overrides the default', () => {
    const history = [entry(20, 3), entry(1, 4)];

    assert.strictEqual(salesVolume(history, { now: NOW, hours: 6 }), 4);
});

test('history with no sales in the window is zero, not null', () => {
    assert.strictEqual(salesVolume([entry(72, 900)], { now: NOW }), 0);
});

test('an empty history is zero -- Steam answered, the item did not sell', () => {
    assert.strictEqual(salesVolume([], { now: NOW }), 0);
});

test('no history at all is null, not zero', () => {
    // What the pass produces on the Lowest sell listing and Highest buy order algorithms:
    // getPriceHistory short-circuits and never asks Steam.
    assert.strictEqual(salesVolume(null, { now: NOW }), null);
    assert.strictEqual(salesVolume(undefined, { now: NOW }), null);
});

test('an unparseable date is left out rather than counted at an unknown time', () => {
    const history = [['not a date', 730, 999], entry(2, 5)];

    assert.strictEqual(salesVolume(history, { now: NOW }), 5);
});

test('a non-numeric quantity does not poison the total', () => {
    const history = [[hoursAgo(2), 730, undefined], entry(2, 5)];

    assert.strictEqual(salesVolume(history, { now: NOW }), 5);
});

test('formatCount groups in threes and leaves small numbers alone', () => {
    assert.strictEqual(formatCount(0), '0');
    assert.strictEqual(formatCount(999), '999');
    assert.strictEqual(formatCount(1284), '1,284');
    assert.strictEqual(formatCount(1234567), '1,234,567');
});

//#region salesRate -- the week, widening to the month
test('the rate windows are a week and a month', () => {
    assert.strictEqual(RATE_WINDOW_HOURS, 24 * 7);
    assert.strictEqual(RATE_FALLBACK_WINDOW_HOURS, 24 * 30);
});

test('a week with sales in it gives the rate, and says so', () => {
    const history = [entry(20, 7), entry(100, 7)];

    assert.deepStrictEqual(salesRate(history, { now: NOW }), {
        perDay: 2,
        windowHours: RATE_WINDOW_HOURS,
    });
});

test('a quiet week widens to the month rather than reporting nothing sells', () => {
    // The case this exists for: 69 sales in a month, none in the last week. A week of
    // nothing would divide the queue into an infinite wait for an item that sells daily.
    const history = [entry(24 * 20, 30), entry(24 * 10, 30)];

    assert.deepStrictEqual(salesRate(history, { now: NOW }), {
        perDay: 2,
        windowHours: RATE_FALLBACK_WINDOW_HOURS,
    });
});

test('a month with nothing in it is a rate of zero over the month, not null', () => {
    const rate = salesRate([entry(24 * 90, 500)], { now: NOW });

    assert.deepStrictEqual(rate, { perDay: 0, windowHours: RATE_FALLBACK_WINDOW_HOURS });
});

test('no history at all gives no rate', () => {
    assert.strictEqual(salesRate(null, { now: NOW }), null);
});
//#endregion

//#region listingsAtOrBelow / queueAheadOf -- the order book side
// What buildOrderBook (src/steam/market.ts) produces: [price in currency units, quantity].
// Steam sends cents and per-price quantities, not a running total -- verified against a live
// order book whose quantities summed to the cSellOrders it reported alongside them.
function book(pairs: [number, number][]) {
    return { sell_order_graph: pairs.map(([cents, qty]) => [cents / 100, qty, '']) };
}

test('counts every listing at or below the price', () => {
    const orderbook = book([
        [5, 10],
        [6, 34],
        [11, 32],
        [12, 33],
    ]);

    assert.strictEqual(listingsAtOrBelow(orderbook, 11), 76);
});

test('a listing priced exactly at the price is counted', () => {
    // 0.05 * 100 is not 5 in binary floating point, so this is the case a naive comparison
    // drops -- and it is the user's own listing, the one that must be there to subtract.
    assert.strictEqual(listingsAtOrBelow(book([[5, 3]]), 5), 3);
    assert.strictEqual(listingsAtOrBelow(book([[7, 3]]), 7), 3);
    assert.strictEqual(listingsAtOrBelow(book([[29, 3]]), 29), 3);
});

test('nothing dearer than the price is counted', () => {
    assert.strictEqual(listingsAtOrBelow(book([[12, 33]]), 11), 0);
});

test('no order book is not known, rather than an empty queue', () => {
    assert.strictEqual(listingsAtOrBelow(null, 11), null);
    assert.strictEqual(listingsAtOrBelow({}, 11), null);
    assert.strictEqual(queueAheadOf(null, 11), null);
});

test('the queue leaves this listing out of its own count', () => {
    assert.strictEqual(queueAheadOf(book([[5, 10]]), 11), 9);
});

test('a queue of one -- only this listing -- is a queue of none ahead', () => {
    assert.strictEqual(queueAheadOf(book([[11, 1]]), 11), 0);
});

test('a book that has not caught up with the listing floors at zero', () => {
    assert.strictEqual(queueAheadOf(book([[12, 5]]), 11), 0);
});
//#endregion

//#region daysToSell
const rateOf = (perDay: number) => ({ perDay, windowHours: RATE_WINDOW_HOURS });

test('the estimate counts this listing as well as the queue ahead of it', () => {
    // 177 ahead at 2.3 a day is 178 sales away, not 177 -- yours has to sell too.
    assert.strictEqual(daysToSell(3, rateOf(2)), 2);
});

test('first in line is the next sale away, not zero days', () => {
    assert.strictEqual(daysToSell(0, rateOf(2)), 0.5);
});

test('no rate, no rate to divide by, and no estimate', () => {
    assert.strictEqual(daysToSell(10, rateOf(0)), null);
    assert.strictEqual(daysToSell(10, null), null);
    assert.strictEqual(daysToSell(null, rateOf(2)), null);
});
//#endregion

//#region formatting
test('the rate keeps one decimal until the decimal is noise', () => {
    assert.strictEqual(formatSalesRate(rateOf(1.7142857)), '1.7');
    assert.strictEqual(formatSalesRate(rateOf(16.4)), '16.4');
    assert.strictEqual(formatSalesRate(rateOf(123.6)), '124');
    assert.strictEqual(formatSalesRate(rateOf(0)), '0');
    assert.strictEqual(formatSalesRate(null), '\u2014');
});

test('the estimate rounds to whole days, and says so when it is under one', () => {
    assert.strictEqual(formatDaysToSell(76.8), '77d');
    assert.strictEqual(formatDaysToSell(0.5), '<1d');
    assert.strictEqual(formatDaysToSell(1), '1d');
    assert.strictEqual(formatDaysToSell(5000), '999+d');
    assert.strictEqual(formatDaysToSell(null), '\u2014');
});
//#endregion

//#region sellSpeedOf -- the two thresholds the estimate is painted by
test('a comfortable estimate is not painted at all', () => {
    assert.strictEqual(sellSpeedOf(1), null);
    assert.strictEqual(sellSpeedOf(14.9), null);
});

test('the thresholds are exclusive, so neither fires on the number it is named after', () => {
    // 15 days is not yet slow and 30 is not yet stalled -- anyone checking "over 15 days"
    // against the cell beside it has to find the two agree.
    assert.strictEqual(sellSpeedOf(15), null);
    assert.strictEqual(sellSpeedOf(15.1), 'slow');
    assert.strictEqual(sellSpeedOf(30), 'slow');
    assert.strictEqual(sellSpeedOf(30.1), 'stalled');
});

test('past a fortnight is slow, past a month has stalled', () => {
    assert.strictEqual(sellSpeedOf(20), 'slow');
    assert.strictEqual(sellSpeedOf(104), 'stalled');
});

test('no estimate is not a warning', () => {
    // Colouring a dash red would say the item has stalled, when what is true is that nothing
    // is known about it -- an algorithm that never fetched the history, or an order book that
    // failed to read.
    assert.strictEqual(sellSpeedOf(null), null);
});
//#endregion
