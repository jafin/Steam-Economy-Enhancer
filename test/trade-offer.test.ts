import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// The aggregation takes the assets of one side of a trade offer and a `resolve` that turns
// an asset into what is known about it, so the test can say what an asset is without a page.
function resolver(byId) {
    return (asset) => byId[asset.assetid] || null;
}

test('an asset that resolves to nothing is an unknown item', () => {
    const summary = see.aggregateTradeOfferAssets([{ assetid: '1' }], resolver({}));

    assert.deepStrictEqual(summary.items, [{ text: 'Unknown Item', count: 1 }]);
    assert.strictEqual(summary.totalPrice, 0);
});

test('the same item twice is counted once with a count of two', () => {
    const card = { name: 'Sackboy', type: 'Trading Card', price: 300 };
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }, { assetid: '2' }],
        resolver({ 1: card, 2: card })
    );

    assert.deepStrictEqual(summary.items, [{ text: 'Sackboy (Trading Card)', count: 2 }]);
});

test('the total is the sum of the prices of the assets in the offer', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }, { assetid: '2' }],
        resolver({
            1: { name: 'Sackboy', price: 300 },
            2: { name: 'Big Daddy', price: 45 }
        })
    );

    assert.strictEqual(summary.totalPrice, 345);
});

test('an item that was never priced adds nothing to the total', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }],
        resolver({ 1: { name: 'Sackboy' } })
    );

    assert.strictEqual(summary.totalPrice, 0);
});

test('an item without a type is named by its name alone', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }],
        resolver({ 1: { name: 'Sackboy', type: '' } })
    );

    assert.deepStrictEqual(summary.items, [{ text: 'Sackboy', count: 1 }]);
});

test('a stack says how many of it are in the offer', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }],
        resolver({ 1: { name: 'Gems', originalAmount: '5', amount: '2' } })
    );

    assert.deepStrictEqual(summary.items, [{ text: '3x Gems', count: 1 }]);
});

test('the items keep the order they were first seen in', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }, { assetid: '2' }, { assetid: '3' }],
        resolver({
            1: { name: 'Sackboy' },
            2: { name: 'Big Daddy' },
            3: { name: 'Sackboy' }
        })
    );

    assert.deepStrictEqual(summary.items, [
        { text: 'Sackboy', count: 2 },
        { text: 'Big Daddy', count: 1 }
    ]);
});

test('an offer with nothing in it is worth nothing', () => {
    const summary = see.aggregateTradeOfferAssets([], resolver({}));

    assert.deepStrictEqual(summary.items, []);
    assert.strictEqual(summary.totalPrice, 0);
});
