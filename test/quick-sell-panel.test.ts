// quickSellPanel: the order book rows and the quick-sell price ladder, pulled out of
// updateInventorySelection in src/inventory/ui.ts as a pure value so the ladder rule --
// including the boundary it turns on -- can be tested without a page or a market call.

import { test } from 'vitest';
import assert from 'node:assert';
import { quickSellPanel } from '../src/inventory/ui.ts';

function formatPrice(cents: number) {
    return `$${(cents / 100).toFixed(2)}`;
}

test('no buy order: the ladder is built from the sell side alone', () => {
    const panel = quickSellPanel({ lowest_sell_order: 500 }, formatPrice);

    assert.deepStrictEqual(panel.prices, [499, 500]);
});

test('no sell order: the ladder is built from the buy side alone', () => {
    const panel = quickSellPanel({ highest_buy_order: 200 }, formatPrice);

    assert.deepStrictEqual(panel.prices, [200]);
});

test('lowest_sell_order of exactly 3 gets no undercut price -- the > 3 boundary', () => {
    // "Transaction volume must be separable into three or more parts (no matter if equal):
    // valve+publisher+seller." At 3 there is nothing left to undercut into.
    const panel = quickSellPanel({ lowest_sell_order: 3 }, formatPrice);

    assert.deepStrictEqual(panel.prices, [3]);
});

test('lowest_sell_order of 4, one past the boundary, does get the undercut price', () => {
    const panel = quickSellPanel({ lowest_sell_order: 4 }, formatPrice);

    assert.deepStrictEqual(panel.prices, [3, 4]);
});

test('a price shared by the buy side and the undercut sell price is not listed twice', () => {
    // highest_buy_order (500) collides with lowest_sell_order - 1 (501 - 1 = 500).
    const panel = quickSellPanel({ highest_buy_order: 500, lowest_sell_order: 501 }, formatPrice);

    assert.deepStrictEqual(panel.prices, [500, 501]);
});

test('prices are sorted ascending regardless of the order the orderbook fields are read in', () => {
    const panel = quickSellPanel({ highest_buy_order: 900, lowest_sell_order: 100 }, formatPrice);

    assert.deepStrictEqual(panel.prices, [99, 100, 900]);
});

test('sellRows and buyRows format each row with the injected formatPrice', () => {
    const panel = quickSellPanel(
        { sell_order_graph: [[1.23, 5]], buy_order_graph: [[0.5, 2]] },
        formatPrice,
    );

    assert.strictEqual(
        panel.sellRows,
        '<tr><td align="right">$1.23</td><td align="right">5</td></tr>',
    );
    assert.strictEqual(
        panel.buyRows,
        '<tr><td align="right">$0.50</td><td align="right">2</td></tr>',
    );
});

test('defaultPrice is the lowest sell order, or 0 when there is none', () => {
    assert.strictEqual(quickSellPanel({ lowest_sell_order: 733 }, formatPrice).defaultPrice, 733);
    assert.strictEqual(quickSellPanel({}, formatPrice).defaultPrice, 0);
});
