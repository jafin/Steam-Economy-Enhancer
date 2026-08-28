'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadUserscript } = require('./harness.js');

const see = loadUserscript();

// Characterisation tests. They pin what the price calculation does today, before it is given
// an honest interface. If a refactor changes any number here, that is a real change to what
// the user's items sell for and it needs saying out loud.

const ALGORITHM_MAX_OF_HISTORY_AND_LISTING = '1';
const ALGORITHM_LOWEST_LISTING = '2';
const ALGORITHM_BUY_ORDER = '3';
const ALGORITHM_HISTORY = '4';

function setAlgorithm(value) {
    globalThis.localStorage.setItem('SETTING_PRICE_ALGORITHM', value);
}

function clearSettings() {
    globalThis.localStorage.clear();
}

// Two sell listings: lowest 10.00, second 12.00. Buy order 8.00.
function orderbook() {
    return {
        highest_buy_order: 800,
        lowest_sell_order: 1000,
        sell_order_graph: [
            [
                10.00,
                40,
                ''
            ],
            [
                12.00,
                60,
                ''
            ]
        ]
    };
}

// One sale, right now, so it lands inside the history window whatever it is set to.
// History prices are in cents, the same as the orderbook: getCurrentPriceHistory multiplies
// them by 100 on the way in. 2000 is therefore above the 1000 lowest listing above.
function history() {
    return [
        [
            new Date().toString(),
            2000,
            5
        ]
    ];
}

test.beforeEach(() => clearSettings());

test('algorithm 2, lowest sell listing, follows the lowest listing', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);

    const price = see.calculateSellPriceBeforeFees(history(), orderbook(), false, 0, 65535);

    assert.strictEqual(price, see.calculateListingPriceBeforeFees(orderbook()));
});

test('algorithm 3 prefers the highest buy order', () => {
    setAlgorithm(ALGORITHM_BUY_ORDER);

    const price = see.calculateSellPriceBeforeFees(history(), orderbook(), false, 0, 65535);

    assert.strictEqual(price, see.calculateBuyOrderPriceBeforeFees(orderbook()));
});

test('algorithm 4 uses the history average and ignores the listings', () => {
    setAlgorithm(ALGORITHM_HISTORY);

    const price = see.calculateSellPriceBeforeFees(history(), orderbook(), false, 0, 65535);

    assert.strictEqual(price, see.calculateAverageHistoryPriceBeforeFees(history()));
});

test('algorithm 1 takes the higher of the history average and the lowest listing', () => {
    setAlgorithm(ALGORITHM_MAX_OF_HISTORY_AND_LISTING);

    const historyPrice = see.calculateAverageHistoryPriceBeforeFees(history());
    const listingPrice = see.calculateListingPriceBeforeFees(orderbook());
    const price = see.calculateSellPriceBeforeFees(history(), orderbook(), false, 0, 65535);

    assert.ok(historyPrice > listingPrice, 'the fixture has history above the listing');
    assert.strictEqual(price, historyPrice);
});

test('with no listings at all the item is listed at the maximum', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);

    const price = see.calculateSellPriceBeforeFees(null, undefined, false, 100, 5000);

    assert.strictEqual(price, 5000);
});

test('a null orderbook is priced, not thrown on', () => {
    // buildOrderBook returns null whenever Steam's response is unsuccessful, and the market
    // listings worker passes that straight through when it is retrying with ignoreErrors.
    // calculateListingPriceBeforeFees guards both undefined and null; its buy-order sibling
    // guarded only undefined, so a failed orderbook fetch threw a TypeError mid-run.
    setAlgorithm(ALGORITHM_LOWEST_LISTING);

    assert.strictEqual(see.calculateBuyOrderPriceBeforeFees(null), 0);
    assert.strictEqual(
        see.calculateSellPriceBeforeFees(null, null, false, 100, 5000),
        5000,
        'falls back to the maximum, the same as an undefined orderbook'
    );
});

test('the offset is applied only when the price was not forced to the maximum', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);
    globalThis.localStorage.setItem('SETTING_PRICE_OFFSET', '1');

    const withoutOffset = see.calculateSellPriceBeforeFees(null, orderbook(), false, 0, 65535);
    const withOffset = see.calculateSellPriceBeforeFees(null, orderbook(), true, 0, 65535);

    assert.strictEqual(withOffset - withoutOffset, 100, 'one unit of currency, in cents');

    // Forced to the max because there are no listings: the offset must not be added, or the
    // item could never be listed at all.
    const forcedToMax = see.calculateSellPriceBeforeFees(null, undefined, true, 100, 5000);

    assert.strictEqual(forcedToMax, 5000);
});

test('the result is clamped to the configured minimum and maximum', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);

    const belowMinimum = see.calculateSellPriceBeforeFees(null, orderbook(), false, 50000, 65535);
    assert.strictEqual(belowMinimum, 50000);

    // A buy order higher than the clamped price still wins, so the maximum is not a hard
    // ceiling. Pinning this because it is surprising, not because it is right.
    const aboveMaximum = see.calculateSellPriceBeforeFees(null, orderbook(), false, 0, 100);
    assert.ok(aboveMaximum >= 100);
});

test('rules can be passed in, so pricing needs no stored settings at all', () => {
    // The point of the rules parameter. Nothing is read from localStorage here, and the same
    // inputs give the same answer every time.
    clearSettings();

    const rules = {
        algorithm: 3,
        offsetCents: 0,
        historyHours: 12,
        ignoreLowestOnLowQuantity: false
    };

    const price = see.calculateSellPriceBeforeFees(
        history(),
        orderbook(),
        false,
        0,
        65535,
        rules
    );

    assert.strictEqual(price, see.calculateBuyOrderPriceBeforeFees(orderbook()));
});

test('the same market data prices differently under different rules', () => {
    clearSettings();

    const base = {
        offsetCents: 0,
        historyHours: 12,
        ignoreLowestOnLowQuantity: false
    };

    const priceUnder = (algorithm) => see.calculateSellPriceBeforeFees(
        history(),
        orderbook(),
        false,
        0,
        65535,
        { ...base, algorithm }
    );

    const byBuyOrder = priceUnder(3);
    const byHistory = priceUnder(4);
    const byListing = priceUnder(2);

    assert.ok(byBuyOrder < byListing, 'the buy order is below the lowest listing');
    assert.ok(byHistory > byListing, 'the history average is above the lowest listing');
});

test('createPricingRules reads every setting the calculation needs', () => {
    clearSettings();
    globalThis.localStorage.setItem('SETTING_PRICE_ALGORITHM', '3');
    globalThis.localStorage.setItem('SETTING_PRICE_OFFSET', '2');
    globalThis.localStorage.setItem('SETTING_PRICE_IGNORE_LOWEST_Q', '1');

    const rules = see.createPricingRules();

    assert.strictEqual(rules.algorithm, 3);
    assert.strictEqual(rules.offsetCents, 200, 'the offset is stored in currency, used in cents');
    assert.strictEqual(rules.ignoreLowestOnLowQuantity, true);
    assert.strictEqual(typeof rules.historyHours, 'number');
    assert.strictEqual(typeof rules.now, 'number', 'the wall clock is read once, not per item');
    assert.strictEqual(typeof rules.useRound, 'boolean');
});

test('the history window is judged against rules.now, not the wall clock', () => {
    // calculateAverageHistoryPriceBeforeFees used to call Date.now() itself. A sale timed
    // relative to an explicit `now` gives the same answer however long the test takes to
    // run, and a fixed instant can place a sale on either side of the window on purpose.
    const now = Date.UTC(2024, 0, 2, 12, 0, 0);
    const rules = { historyHours: 12, now };

    const insideWindow = [[new Date(now - 6 * 60 * 60 * 1000).toString(), 2000, 5]];
    const outsideWindow = [[new Date(now - 18 * 60 * 60 * 1000).toString(), 2000, 5]];

    assert.ok(
        see.calculateAverageHistoryPriceBeforeFees(insideWindow, rules) > 0,
        'a sale 6 hours before `now` is inside a 12 hour window'
    );
    assert.strictEqual(
        see.calculateAverageHistoryPriceBeforeFees(outsideWindow, rules),
        0,
        'a sale 18 hours before `now` is outside a 12 hour window, whatever time it actually is'
    );
});

test('the ignore-lowest-quantity ladder reaches every one of its six branches', () => {
    // The architecture review claimed four of these six were unreachable. They are not.
    // Each branch pairs a decreasing quantity bound with an increasing percentage bound, so
    // branch N+1 fires exactly when branch N's percentage test fails while the tighter
    // quantity bound still holds.
    globalThis.localStorage.setItem('SETTING_PRICE_IGNORE_LOWEST_Q', '1');

    const probes = [
        [2000, 4],
        [500, 8],
        [50, 12],
        [30, 18],
        [20, 23],
        [5, 28]
    ];

    for (const [secondQuantity, percentage] of probes) {
        const lowestQuantity = Math.round(secondQuantity * percentage / 100);

        const book = {
            highest_buy_order: 0,
            lowest_sell_order: 1000,
            sell_order_graph: [
                [
                    10.00,
                    lowestQuantity,
                    ''
                ],
                [
                    12.00,
                    secondQuantity,
                    ''
                ]
            ]
        };

        const price = see.calculateListingPriceBeforeFees(book);
        const secondLowest = see.calculateListingPriceBeforeFees({
            highest_buy_order: 0,
            lowest_sell_order: 1200,
            sell_order_graph: []
        });

        assert.strictEqual(
            price,
            secondLowest,
            `q2=${secondQuantity} pct=${percentage}: expected the thin lowest listing to be ignored`
        );
    }
});
