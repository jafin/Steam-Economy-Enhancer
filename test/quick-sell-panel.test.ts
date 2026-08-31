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

// --- the rendered ladder, and what a click on it actually queues ---------------------------
//
// The tests above pin the ladder as a value. These pin the step after it: the buttons
// updateInventorySelection renders from that value, and the price a click on one pushes onto
// the sell queue.
//
// That step used to run through a DOM id -- the price was written into `id="quick_sell499"`
// and parsed back out of the id on click, which made an element id the data model and worked
// only because getPriceBeforeFees opens with Math.round() and coerced the string. Nothing
// covered it, so this is the assertion the round-trip was silently carrying.

import { beforeEach, test as vitestTest } from 'vitest';
import $ from 'jquery';
import { updateInventorySelection } from '../src/inventory/ui.ts';
import { sellQueue } from '../src/inventory/sell.ts';
import { market } from '../src/steam/market.ts';

// Steam's iteminfo panel, in the shape steamPage.itemInfoPanel() and itemOwnerActions() read:
// the market listing anchor, and the two levels of nesting above it that the quick-sell
// buttons attach to.
function buildItemInfoPanel(marketLink: string) {
    document.body.innerHTML = `
        <div id="iteminfo0">
            <h1>Sackboy</h1>
            <div><span>Community</span></div>
            <div><div><a href="${marketLink}">View in market</a></div></div>
        </div>`;
    (globalThis as any).unsafeWindow.iActiveSelectView = 0;
}

// The orderbook response buildOrderBook() parses, with one sell order and one buy order.
function answerOrderBookWith(minSell: number, maxBuy: number) {
    ($ as any).ajax = (settings: any) => {
        const xhr = { status: 200, responseText: '' };
        settings.success(
            {
                data: {
                    success: true,
                    data: {
                        amtMinSellOrder: minSell,
                        amtMaxBuyOrder: maxBuy,
                        rgCompactSellOrders: [minSell, 1],
                        rgCompactBuyOrders: [maxBuy, 1],
                    },
                },
            },
            'success',
            xhr,
        );
        settings.complete(xhr, 'success');
    };
}

function flush(ms = 0) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

// The panel is rendered from inside market.getOrderBook's callback, which goes through
// net/request.ts -- so it lands a few turns of the event loop after updateInventorySelection
// resolves, not on the same tick. Polled rather than slept on, so the test does not encode a
// particular request delay.
async function waitForSelector(selector: string, timeoutMs = 3000) {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline && $(selector).length === 0) {
        await flush(20);
    }
}

beforeEach(() => {
    document.body.innerHTML = '';
    sellQueue.kill();
});

vitestTest('each ladder button queues its own price, before fees', async () => {
    const marketLink = 'https://steamcommunity.com/market/listings/753/Sackboy';
    buildItemInfoPanel(marketLink);
    answerOrderBookWith(500, 200);

    const pushed: any[] = [];
    const originalPush = sellQueue.push;
    (sellQueue as any).push = (task: any) => pushed.push(task);

    await updateInventorySelection({
        appid: 753,
        contextid: '6',
        id: '1',
        marketable: 1,
        name: 'Sackboy',
        description: { market_hash_name: 'Sackboy' },
    });
    await waitForSelector('#price_buttons .quick_sell');

    // The ladder rule itself is pinned by the tests above; what matters here is that the
    // rendered buttons are one-for-one with it and that a click carries the right one.
    const expected = quickSellPanel(
        { lowest_sell_order: 500, highest_buy_order: 200 },
        formatPrice,
    ).prices;

    const buttons = $('#price_buttons .quick_sell');
    assert.strictEqual(buttons.length, expected.length, 'one button per ladder price');

    // No price is serialised into the markup any more.
    assert.strictEqual($('#price_buttons [id^="quick_sell"]').length, 0);

    buttons.each(function () {
        $(this).trigger('click');
    });

    (sellQueue as any).push = originalPush;

    assert.deepStrictEqual(
        pushed.map((task) => task.sellPrice),
        expected.map((cents: number) => market.getPriceBeforeFees(cents)),
        'each button must queue the price it displays, not its neighbour and not NaN',
    );

    // And the item, not a stale one from a previous panel.
    assert.deepStrictEqual(
        pushed.map((task) => task.item.id),
        expected.map(() => '1'),
    );
});
