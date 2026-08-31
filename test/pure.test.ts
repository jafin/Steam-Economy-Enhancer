import { test } from 'vitest';
import assert from 'node:assert';
import {
    CalculateAmountToSendForDesiredReceivedAmount,
    CalculateFeeAmount,
    clamp,
    priceBeforeFees,
    priceIncludingFees,
} from '../src/pricing/fees.ts';
import { getNumberOfDigits, padLeftZero, replaceNonNumbers } from '../src/util/numbers.ts';
import { isRetryMessage } from '../src/net/request.ts';
import {
    getIsCrate,
    getIsFoilTradingCard,
    getIsTradingCard,
    getMarketHashName,
} from '../src/items/index.ts';
import { buildOrderBook } from '../src/steam/market.ts';

// A wallet shaped like the one Steam puts on the page. `wallet_fee` is the flag the fee
// maths checks first; without it every fee is zero.
const wallet = {
    wallet_fee: 1,
    wallet_fee_base: 0,
    wallet_fee_percent: 0.05,
    wallet_fee_minimum: 1,
    wallet_publisher_fee_percent_default: 0.1,
    wallet_currency: 3,
};

test('clamp keeps a value inside its bounds', () => {
    assert.strictEqual(clamp(5, 1, 10), 5);
    assert.strictEqual(clamp(0, 1, 10), 1);
    assert.strictEqual(clamp(50, 1, 10), 10);
});

test('getNumberOfDigits counts digits', () => {
    assert.strictEqual(getNumberOfDigits(1), 1);
    assert.strictEqual(getNumberOfDigits(10), 2);
    assert.strictEqual(getNumberOfDigits(1000), 4);
});

test('padLeftZero pads up to a width and never truncates', () => {
    assert.strictEqual(padLeftZero(7, 3), '007');
    assert.strictEqual(padLeftZero(1234, 3), '1234');
});

test('replaceNonNumbers pulls the listing id out of a DOM id', () => {
    assert.strictEqual(replaceNonNumbers('mylisting_123_name'), '123');
    assert.strictEqual(replaceNonNumbers('no digits here'), '');
});

test('isRetryMessage recognises only the three known Steam messages', () => {
    assert.strictEqual(
        isRetryMessage('You cannot sell any items until your previous action completes.'),
        true,
    );
    assert.strictEqual(isRetryMessage('Some other failure'), false);
});

test('getMarketHashName prefers the nested description over the flat item', () => {
    assert.strictEqual(
        getMarketHashName({
            market_hash_name: 'flat',
            description: { market_hash_name: 'nested' },
        }),
        'nested',
    );
    assert.strictEqual(getMarketHashName({ market_hash_name: 'flat' }), 'flat');
    assert.strictEqual(getMarketHashName({ name: 'only a name' }), 'only a name');
    assert.strictEqual(getMarketHashName(null), null);
});

test('buildOrderBook rejects an unsuccessful response', () => {
    assert.strictEqual(buildOrderBook(null), null);
    assert.strictEqual(buildOrderBook({ success: false }), null);
});

test('buildOrderBook pairs the compact orders into price and quantity', () => {
    const book: any = buildOrderBook({
        success: true,
        data: {
            amtMaxBuyOrder: '12',
            amtMinSellOrder: '20',
            rgCompactBuyOrders: [1200, 3, 1100, 5],
            rgCompactSellOrders: [2000, 1],
        },
    });

    assert.strictEqual(book.highest_buy_order, 12);
    assert.strictEqual(book.lowest_sell_order, 20);
    assert.deepStrictEqual(book.buy_order_graph, [
        [12, 3, ''],
        [11, 5, ''],
    ]);
    assert.strictEqual(book.sell_order_graph.length, 1);
});

test('CalculateFeeAmount splits a price into steam and publisher fees', () => {
    const fee: any = CalculateFeeAmount(1000, 0.1, wallet, false);

    assert.strictEqual(fee.amount, 1000);
    assert.strictEqual(fee.steam_fee, 43);
    assert.strictEqual(fee.publisher_fee, 87);
    assert.strictEqual(fee.fees, fee.steam_fee + fee.publisher_fee);
});

test('CalculateAmountToSendForDesiredReceivedAmount floors the fee by default', () => {
    const sent = CalculateAmountToSendForDesiredReceivedAmount(87, 0.1, wallet, false);

    assert.strictEqual(sent.amount, 99);
    assert.strictEqual(sent.fees, 12);
});

test('CalculateAmountToSendForDesiredReceivedAmount rounds instead of floors when useRound is set', () => {
    // useRound used to be a module-level closure fixed by GetCurrencyCode() at load time, so
    // the round branch could never be reached from a test. It is a parameter now: the eleven
    // currencies Steam rounds for (JPY, KRW, ...) are exercised the same way any other rule
    // input is, by passing the value in.
    const floored = CalculateAmountToSendForDesiredReceivedAmount(87, 0.1, wallet, false);
    const rounded = CalculateAmountToSendForDesiredReceivedAmount(87, 0.1, wallet, true);

    assert.strictEqual(floored.amount, 99);
    assert.strictEqual(
        rounded.amount,
        100,
        'the publisher fee half-cent rounds up instead of down',
    );
});

test('priceBeforeFees and priceIncludingFees answer from `rules` alone', () => {
    // priceBeforeFees/priceIncludingFees used to be SteamMarket prototype methods, reaching
    // for `this.walletInfo` and the module-level `useRound`. A wallet and a rounding rule
    // the harness's `market` singleton has never seen still produce the right answer, which
    // is the point: nothing here comes from a page.
    const otherWallet = {
        wallet_fee: 1,
        wallet_fee_base: 0,
        wallet_fee_percent: 0.1,
        wallet_fee_minimum: 1,
        wallet_publisher_fee_percent_default: 0.05,
    };

    const before = priceBeforeFees(1000, null, { walletInfo: otherWallet, useRound: true });
    const after = priceIncludingFees(before, null, { walletInfo: otherWallet, useRound: true });

    assert.ok(before < 1000, 'fees were taken out');
    // CalculateFeeAmount's own comment admits it: "we could be off a cent or two". Not an
    // exact round trip, just close, which is the existing, deliberate behaviour.
    assert.ok(Math.abs(after - 1000) <= 1, 'and the round trip lands back within a cent');
});

test('priceBeforeFees prefers an item-specific fee over the wallet default', () => {
    const rules = { walletInfo: wallet, useRound: false };
    const item = { market_fee: 0 };

    const withDefaultFee = priceBeforeFees(1000, null, rules);
    const withItemFee = priceBeforeFees(1000, item, rules);

    assert.ok(withItemFee > withDefaultFee, 'a zero publisher fee takes less out of the price');
});

test('getIsTradingCard detects a card by its item_class tag', () => {
    const card = {
        tags: [
            {
                category: 'item_class',
                internal_name: 'item_class_2',
            },
        ],
    };

    assert.strictEqual(getIsTradingCard(card), true);
    assert.strictEqual(getIsTradingCard(null), false);
    assert.strictEqual(getIsTradingCard({ name: 'not a card' }), false);
});

test('getIsTradingCard falls back to the gamecards link and the type string', () => {
    assert.strictEqual(
        getIsTradingCard({
            owner_actions: [{ link: 'http://steamcommunity.com/my/gamecards/503820/' }],
        }),
        true,
    );

    assert.strictEqual(getIsTradingCard({ type: 'Portal 2 Trading Card' }), true);
});

test('getIsFoilTradingCard separates foil cards from ordinary ones', () => {
    const plain = {
        tags: [
            {
                category: 'item_class',
                internal_name: 'item_class_2',
            },
        ],
    };

    assert.strictEqual(getIsFoilTradingCard(plain), false);
    assert.strictEqual(getIsFoilTradingCard({ type: 'Portal 2 Foil Trading Card' }), true);
    assert.strictEqual(getIsFoilTradingCard(null), false);
});

//
// Characterisation tests below. These pin behaviour that is wrong on purpose, so that the
// agent that fixes it has a failing test to flip rather than a guess. See AGENT-5 and
// AGENT-6 in the sequencing plan.
//

test('CHARACTERISATION: a wallet with no wallet_fee produces fee-free prices', () => {
    // A logged-out or wallet-less run silently prices items with no fees at all rather
    // than refusing. Owner: not yet assigned.
    assert.deepStrictEqual(CalculateFeeAmount(100, 0.1, null), { fees: 0 });
    assert.deepStrictEqual(CalculateFeeAmount(100, 0.1, {}), { fees: 0 });
});

test('getIsCrate returns a boolean on every path', () => {
    // It used to fall off the end and return undefined for every non-crate item, because
    // it had no terminal `return false`. Only a null item yielded an actual boolean.
    assert.strictEqual(getIsCrate(null), false);
    assert.strictEqual(getIsCrate({ name: 'no tags at all' }), false);
    assert.strictEqual(
        getIsCrate({
            tags: [
                {
                    category: 'Type',
                    internal_name: 'Trading Card',
                },
            ],
        }),
        false,
    );

    assert.strictEqual(
        getIsCrate({
            tags: [
                {
                    category: 'Type',
                    internal_name: 'Supply Crate',
                },
            ],
        }),
        true,
    );
});

// --- tags on the item, or on its description ----------------------------------------------
//
// getIsCrate, getIsTradingCard and getIsFoilTradingCard each wrote out the same nested
// ternary to find the tags, because they live on the item itself on the inventory page and on
// its description on the market page. That is one helper now, so the both-locations rule is
// pinned once here rather than assumed three times.

test('a crate is recognised by tags on the item and by tags on its description', () => {
    const tags = [{ category: 'Type', internal_name: 'Supply Crate' }];

    assert.strictEqual(getIsCrate({ tags }), true, 'inventory page shape');
    assert.strictEqual(getIsCrate({ description: { tags } }), true, 'market page shape');
});

test('a trading card is recognised by tags on the item and by tags on its description', () => {
    const tags = [{ category: 'item_class', internal_name: 'item_class_2' }];

    assert.strictEqual(getIsTradingCard({ tags }), true);
    assert.strictEqual(getIsTradingCard({ description: { tags } }), true);
});

test('a foil card is recognised by tags on the item and by tags on its description', () => {
    const tags = [
        { category: 'item_class', internal_name: 'item_class_2' },
        { category: 'cardborder', internal_name: 'cardborder_1' },
    ];

    assert.strictEqual(getIsFoilTradingCard({ tags }), true);
    assert.strictEqual(getIsFoilTradingCard({ description: { tags } }), true);
});

// The item's own tags win: an empty array on the item is still an answer, and must not fall
// through to the description. That is what the original nested ternary's `!= null` test did.
test('an empty tags array on the item does not fall through to the description', () => {
    const item = {
        tags: [],
        description: { tags: [{ category: 'Type', internal_name: 'Supply Crate' }] },
    };

    assert.strictEqual(getIsCrate(item), false);
});

test('the tag predicates are false for an item with no tags in either place', () => {
    assert.strictEqual(getIsCrate({ description: {} }), false);
    assert.strictEqual(getIsTradingCard({ description: {} }), false);
    assert.strictEqual(getIsFoilTradingCard({ description: {} }), false);
});

// padLeftZero was a recursion that prepended one '0' per call; it is String.padStart now.
// The task flagged a negative `max` as the case where the two might part company, since the
// recursion compared length *after* coercion -- they do not: `length < -1` is false and
// padStart pads to a minimum, so both leave the string alone.
test('padLeftZero leaves a string alone for a zero or negative width', () => {
    assert.strictEqual(padLeftZero(5, 0), '5');
    assert.strictEqual(padLeftZero(5, -1), '5');
});

test('padLeftZero coerces a non-string before padding', () => {
    assert.strictEqual(padLeftZero(12, 4), '0012');
    assert.strictEqual(padLeftZero('', 3), '000');
});
