import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';
import { getPriceInformationFromItem } from '../src/pricing/algorithms.ts';

// Characterisation tests. They pin what the price calculation does today, before it is given
// an honest interface. If a refactor changes any number here, that is a real change to what
// the user's items sell for and it needs saying out loud.

const ALGORITHM_MAX_OF_HISTORY_AND_LISTING = '1';
const ALGORITHM_LOWEST_LISTING = '2';
const ALGORITHM_BUY_ORDER = '3';
const ALGORITHM_HISTORY = '4';

function setAlgorithm(value: any) {
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
            [10.0, 40, ''],
            [12.0, 60, ''],
        ],
    };
}

// One sale, right now, so it lands inside the history window whatever it is set to.
// History prices are in cents, the same as the orderbook: getCurrentPriceHistory multiplies
// them by 100 on the way in. 2000 is therefore above the 1000 lowest listing above.
function history() {
    return [[new Date().toString(), 2000, 5]];
}

// Card-class fixtures for the bounds characterisation below. Tags are what getIsTradingCard
// and getIsFoilTradingCard read on the inventory page.
const normalCardItem = { tags: [{ category: 'item_class', internal_name: 'item_class_2' }] };
const foilCardItem = {
    tags: [
        { category: 'item_class', internal_name: 'item_class_2' },
        { category: 'cardborder', internal_name: 'cardborder_1' },
    ],
};
const nonCardItem = {};

// A single, thin listing with no buy order: calculateSellPriceBeforeFees has nothing to
// calculate from, so the result is exactly the clamped minimum. That is what makes it a
// clean probe for the bounds specifically, independent of the pricing algorithm.
function thinOrderbook() {
    return { highest_buy_order: 0, lowest_sell_order: 1, sell_order_graph: [[0.01, 1, '']] };
}

test.beforeEach(() => clearSettings());

test('CHARACTERISATION: a normal trading card is priced within its own min/max settings', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);
    globalThis.localStorage.setItem('SETTING_MIN_NORMAL_PRICE', '1.00');
    globalThis.localStorage.setItem('SETTING_MAX_NORMAL_PRICE', '3.00');

    const priceInfo = getPriceInformationFromItem(normalCardItem);
    assert.strictEqual(priceInfo.minPriceBeforeFees, 100);
    assert.strictEqual(priceInfo.maxPriceBeforeFees, 300);

    const price = see.calculateSellPriceBeforeFees(
        null,
        thinOrderbook(),
        false,
        priceInfo.minPriceBeforeFees,
        priceInfo.maxPriceBeforeFees,
    );

    assert.strictEqual(price, 100, 'clamped up to the normal card minimum');
});

test('CHARACTERISATION: a foil trading card is priced within its own min/max settings', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);
    globalThis.localStorage.setItem('SETTING_MIN_FOIL_PRICE', '2.00');
    globalThis.localStorage.setItem('SETTING_MAX_FOIL_PRICE', '5.00');

    const priceInfo = getPriceInformationFromItem(foilCardItem);
    assert.strictEqual(priceInfo.minPriceBeforeFees, 200);
    assert.strictEqual(priceInfo.maxPriceBeforeFees, 500);

    const price = see.calculateSellPriceBeforeFees(
        null,
        thinOrderbook(),
        false,
        priceInfo.minPriceBeforeFees,
        priceInfo.maxPriceBeforeFees,
    );

    assert.strictEqual(price, 200, 'clamped up to the foil card minimum');
});

test('CHARACTERISATION: a non-card item is priced within the misc min/max settings', () => {
    setAlgorithm(ALGORITHM_LOWEST_LISTING);
    globalThis.localStorage.setItem('SETTING_MIN_MISC_PRICE', '0.50');
    globalThis.localStorage.setItem('SETTING_MAX_MISC_PRICE', '8.00');

    const priceInfo = getPriceInformationFromItem(nonCardItem);
    assert.strictEqual(priceInfo.minPriceBeforeFees, 50);
    assert.strictEqual(priceInfo.maxPriceBeforeFees, 800);

    const price = see.calculateSellPriceBeforeFees(
        null,
        thinOrderbook(),
        false,
        priceInfo.minPriceBeforeFees,
        priceInfo.maxPriceBeforeFees,
    );

    assert.strictEqual(price, 50, 'clamped up to the misc minimum');
});

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

test('CHARACTERISATION: the buy-order branch fires at the price floor of 1, not just above it', () => {
    // calculateSellPriceBeforeFees used to guard this branch with `buyPrice !== -2`, but
    // calculateBuyOrderPriceBeforeFees can never return -2: priceBeforeFees's own floor is 1
    // (`return (price > feeInfo.fees) ? price - feeInfo.fees : 1`). The guard was provably
    // always true and was removed in 9a9b5ae. This pins the branch at that floor, the one
    // value the old guard could have been imagined to protect against.
    setAlgorithm(ALGORITHM_BUY_ORDER);

    const thinBook = {
        highest_buy_order: 1,
        lowest_sell_order: 1000,
        sell_order_graph: [[10.0, 1, '']],
    };

    const price = see.calculateSellPriceBeforeFees(null, thinBook, false, 0, 65535);

    assert.strictEqual(price, see.calculateBuyOrderPriceBeforeFees(thinBook));
    assert.strictEqual(price, 1);
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
        'falls back to the maximum, the same as an undefined orderbook',
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
        ignoreLowestOnLowQuantity: false,
    };

    const price = see.calculateSellPriceBeforeFees(history(), orderbook(), false, 0, 65535, rules);

    assert.strictEqual(price, see.calculateBuyOrderPriceBeforeFees(orderbook()));
});

test('the same market data prices differently under different rules', () => {
    clearSettings();

    const base = {
        offsetCents: 0,
        historyHours: 12,
        ignoreLowestOnLowQuantity: false,
    };

    const priceUnder = (algorithm: any) =>
        see.calculateSellPriceBeforeFees(history(), orderbook(), false, 0, 65535, {
            ...base,
            algorithm,
        });

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
        'a sale 6 hours before `now` is inside a 12 hour window',
    );
    assert.strictEqual(
        see.calculateAverageHistoryPriceBeforeFees(outsideWindow, rules),
        0,
        'a sale 18 hours before `now` is outside a 12 hour window, whatever time it actually is',
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
        [5, 28],
    ];

    for (const [secondQuantity, percentage] of probes) {
        const lowestQuantity = Math.round((secondQuantity * percentage) / 100);

        const book = {
            highest_buy_order: 0,
            lowest_sell_order: 1000,
            sell_order_graph: [
                [10.0, lowestQuantity, ''],
                [12.0, secondQuantity, ''],
            ],
        };

        const price = see.calculateListingPriceBeforeFees(book);
        const secondLowest = see.calculateListingPriceBeforeFees({
            highest_buy_order: 0,
            lowest_sell_order: 1200,
            sell_order_graph: [],
        });

        assert.strictEqual(
            price,
            secondLowest,
            `q2=${secondQuantity} pct=${percentage}: expected the thin lowest listing to be ignored`,
        );
    }
});
