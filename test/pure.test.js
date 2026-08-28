'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadUserscript } = require('./harness.js');

const see = loadUserscript();

// A wallet shaped like the one Steam puts on the page. `wallet_fee` is the flag the fee
// maths checks first; without it every fee is zero.
const wallet = {
    wallet_fee: 1,
    wallet_fee_base: 0,
    wallet_fee_percent: 0.05,
    wallet_fee_minimum: 1,
    wallet_publisher_fee_percent_default: 0.10,
    wallet_currency: 3
};

test('clamp keeps a value inside its bounds', () => {
    assert.strictEqual(see.clamp(5, 1, 10), 5);
    assert.strictEqual(see.clamp(0, 1, 10), 1);
    assert.strictEqual(see.clamp(50, 1, 10), 10);
});

test('getNumberOfDigits counts digits', () => {
    assert.strictEqual(see.getNumberOfDigits(1), 1);
    assert.strictEqual(see.getNumberOfDigits(10), 2);
    assert.strictEqual(see.getNumberOfDigits(1000), 4);
});

test('padLeftZero pads up to a width and never truncates', () => {
    assert.strictEqual(see.padLeftZero(7, 3), '007');
    assert.strictEqual(see.padLeftZero(1234, 3), '1234');
});

test('replaceNonNumbers pulls the listing id out of a DOM id', () => {
    assert.strictEqual(see.replaceNonNumbers('mylisting_123_name'), '123');
    assert.strictEqual(see.replaceNonNumbers('no digits here'), '');
});

test('isRetryMessage recognises only the three known Steam messages', () => {
    assert.strictEqual(
        see.isRetryMessage('You cannot sell any items until your previous action completes.'),
        true
    );
    assert.strictEqual(see.isRetryMessage('Some other failure'), false);
});

test('getMarketHashName prefers the nested description over the flat item', () => {
    assert.strictEqual(
        see.getMarketHashName({
            market_hash_name: 'flat',
            description: { market_hash_name: 'nested' }
        }),
        'nested'
    );
    assert.strictEqual(see.getMarketHashName({ market_hash_name: 'flat' }), 'flat');
    assert.strictEqual(see.getMarketHashName({ name: 'only a name' }), 'only a name');
    assert.strictEqual(see.getMarketHashName(null), null);
});

test('buildOrderBook rejects an unsuccessful response', () => {
    assert.strictEqual(see.buildOrderBook(null), null);
    assert.strictEqual(see.buildOrderBook({ success: false }), null);
});

test('buildOrderBook pairs the compact orders into price and quantity', () => {
    const book = see.buildOrderBook({
        success: true,
        data: {
            amtMaxBuyOrder: '12',
            amtMinSellOrder: '20',
            rgCompactBuyOrders: [
                1200,
                3,
                1100,
                5
            ],
            rgCompactSellOrders: [
                2000,
                1
            ]
        }
    });

    assert.strictEqual(book.highest_buy_order, 12);
    assert.strictEqual(book.lowest_sell_order, 20);
    assert.deepStrictEqual(book.buy_order_graph, [
        [
            12,
            3,
            ''
        ],
        [
            11,
            5,
            ''
        ]
    ]);
    assert.strictEqual(book.sell_order_graph.length, 1);
});

test('CalculateFeeAmount splits a price into steam and publisher fees', () => {
    const fee = see.CalculateFeeAmount(1000, 0.10, wallet);

    assert.strictEqual(fee.amount, 1000);
    assert.strictEqual(fee.steam_fee, 43);
    assert.strictEqual(fee.publisher_fee, 87);
    assert.strictEqual(fee.fees, fee.steam_fee + fee.publisher_fee);
});

test('CalculateAmountToSendForDesiredReceivedAmount rounds up to a payable amount', () => {
    const sent = see.CalculateAmountToSendForDesiredReceivedAmount(87, 0.10, wallet);

    assert.strictEqual(sent.amount, 99);
    assert.strictEqual(sent.fees, 12);
});

test('getIsTradingCard detects a card by its item_class tag', () => {
    const card = {
        tags: [
            {
                category: 'item_class',
                internal_name: 'item_class_2'
            }
        ]
    };

    assert.strictEqual(see.getIsTradingCard(card), true);
    assert.strictEqual(see.getIsTradingCard(null), false);
    assert.strictEqual(see.getIsTradingCard({ name: 'not a card' }), false);
});

test('getIsTradingCard falls back to the gamecards link and the type string', () => {
    assert.strictEqual(
        see.getIsTradingCard({
            owner_actions: [
                { link: 'http://steamcommunity.com/my/gamecards/503820/' }
            ]
        }),
        true
    );

    assert.strictEqual(see.getIsTradingCard({ type: 'Portal 2 Trading Card' }), true);
});

test('getIsFoilTradingCard separates foil cards from ordinary ones', () => {
    const plain = {
        tags: [
            {
                category: 'item_class',
                internal_name: 'item_class_2'
            }
        ]
    };

    assert.strictEqual(see.getIsFoilTradingCard(plain), false);
    assert.strictEqual(see.getIsFoilTradingCard({ type: 'Portal 2 Foil Trading Card' }), true);
    assert.strictEqual(see.getIsFoilTradingCard(null), false);
});

//
// Characterisation tests below. These pin behaviour that is wrong on purpose, so that the
// agent that fixes it has a failing test to flip rather than a guess. See AGENT-5 and
// AGENT-6 in the sequencing plan.
//

test('CHARACTERISATION: a wallet with no wallet_fee produces fee-free prices', () => {
    // A logged-out or wallet-less run silently prices items with no fees at all rather
    // than refusing. Owner: not yet assigned.
    assert.deepStrictEqual(see.CalculateFeeAmount(100, 0.10, null), { fees: 0 });
    assert.deepStrictEqual(see.CalculateFeeAmount(100, 0.10, {}), { fees: 0 });
});

test('getIsCrate returns a boolean on every path', () => {
    // It used to fall off the end and return undefined for every non-crate item, because
    // it had no terminal `return false`. Only a null item yielded an actual boolean.
    assert.strictEqual(see.getIsCrate(null), false);
    assert.strictEqual(see.getIsCrate({ name: 'no tags at all' }), false);
    assert.strictEqual(
        see.getIsCrate({
            tags: [
                {
                    category: 'Type',
                    internal_name: 'Trading Card'
                }
            ]
        }),
        false
    );

    assert.strictEqual(
        see.getIsCrate({
            tags: [
                {
                    category: 'Type',
                    internal_name: 'Supply Crate'
                }
            ]
        }),
        true
    );
});
