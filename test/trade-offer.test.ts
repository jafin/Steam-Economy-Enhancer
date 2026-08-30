import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// The aggregation takes the assets of one side of a trade offer and a `resolve` that turns
// an asset into what is known about it, so the test can say what an asset is without a page.
function resolver(byId: Record<string, any>) {
    return (asset: any) => byId[asset.assetid] || null;
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
        resolver({ 1: card, 2: card }),
    );

    assert.deepStrictEqual(summary.items, [{ text: 'Sackboy (Trading Card)', count: 2 }]);
});

test('the total is the sum of the prices of the assets in the offer', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }, { assetid: '2' }],
        resolver({
            1: { name: 'Sackboy', price: 300 },
            2: { name: 'Big Daddy', price: 45 },
        }),
    );

    assert.strictEqual(summary.totalPrice, 345);
});

test('an item that was never priced adds nothing to the total', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }],
        resolver({ 1: { name: 'Sackboy' } }),
    );

    assert.strictEqual(summary.totalPrice, 0);
});

test('an item without a type is named by its name alone', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }],
        resolver({ 1: { name: 'Sackboy', type: '' } }),
    );

    assert.deepStrictEqual(summary.items, [{ text: 'Sackboy', count: 1 }]);
});

test('a stack says how many of it are in the offer', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }],
        resolver({ 1: { name: 'Gems', originalAmount: '5', amount: '2' } }),
    );

    assert.deepStrictEqual(summary.items, [{ text: '3x Gems', count: 1 }]);
});

test('the items keep the order they were first seen in', () => {
    const summary = see.aggregateTradeOfferAssets(
        [{ assetid: '1' }, { assetid: '2' }, { assetid: '3' }],
        resolver({
            1: { name: 'Sackboy' },
            2: { name: 'Big Daddy' },
            3: { name: 'Sackboy' },
        }),
    );

    assert.deepStrictEqual(summary.items, [
        { text: 'Sackboy', count: 2 },
        { text: 'Big Daddy', count: 1 },
    ]);
});

test('an offer with nothing in it is worth nothing', () => {
    const summary = see.aggregateTradeOfferAssets([], resolver({}));

    assert.deepStrictEqual(summary.items, []);
    assert.strictEqual(summary.totalPrice, 0);
});

// sumTradeOfferAssets is what actually renders the summary the user sees, and it does
// more than aggregateTradeOfferAssets: it sorts the aggregate's [text, count] pairs by
// count ascending and then reverses the result, rather than sorting descending directly.
// Those are not the same thing when counts tie -- see the comment above the sort in
// tradeoffer/ui.ts. This test pins what that produces today, not what it should produce:
// with equal counts, the item seen second ('Beta') is displayed before the item seen
// first ('Alpha'). Reads through the live steamPage adapter, so the trade offer's assets
// and item lookups are set on unsafeWindow the way Steam's own page would provide them.
test('equal counts display in reverse first-seen order', () => {
    const win = (globalThis as any).unsafeWindow;

    win.g_rgCurrentTradeStatus.me = {
        assets: [
            { appid: 730, contextid: '2', assetid: '1' },
            { appid: 730, contextid: '2', assetid: '2' },
            { appid: 730, contextid: '2', assetid: '3' },
            { appid: 730, contextid: '2', assetid: '4' },
        ],
    };

    const itemsById: Record<string, any> = {
        1: { name: 'Alpha' },
        2: { name: 'Alpha' },
        3: { name: 'Beta' },
        4: { name: 'Beta' },
    };

    win.UserYou.findAsset = (appid: unknown, contextid: unknown, assetid: string) =>
        itemsById[assetid] || null;

    const summaryText = see.sumTradeOfferAssets('me');

    const alphaIndex = summaryText.indexOf('2x Alpha');
    const betaIndex = summaryText.indexOf('2x Beta');

    assert.ok(alphaIndex >= 0 && betaIndex >= 0);
    assert.ok(
        betaIndex < alphaIndex,
        "Beta (seen second) is expected before Alpha (seen first) -- today's reverse-first-seen tie order",
    );
});
