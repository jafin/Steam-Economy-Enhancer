// Where the liquidity 2x2 lands on a market row, and what it says when a value is not known.
//
// The arithmetic is pinned in test/liquidity.test.ts and the wiring in
// test/pricing-inputs-preamble.test.ts; this is the DOM contract in between -- which cell it
// goes into, that it comes before the Remove button, that a second pricing pass replaces it
// rather than stacking another under it, and that a value nobody knows shows as a dash
// instead of a fabricated zero.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import { renderListingStats } from '../src/market/listings.ts';
import { RATE_WINDOW_HOURS } from '../src/pricing/liquidity.ts';

// The Remove column, the way Steam draws it and addMarketCheckboxes (src/market/listings.ts)
// leaves it: the cancel button, and the select checkbox this script puts in the corner.
function row(): JQuery {
    document.body.innerHTML = `
        <div class="market_listing_row">
            <div class="market_listing_edit_buttons actual_content">
                <div class="market_listing_cancel_button">
                    <a class="item_market_action_button">Remove</a>
                    <div class="market_listing_select"><input type="checkbox" class="market_select_item"/></div>
                </div>
            </div>
            <div class="market_listing_my_price"></div>
        </div>`;

    return $('.market_listing_row');
}

const rate = (perDay: number) => ({ perDay, windowHours: RATE_WINDOW_HOURS });

const full = {
    volume: 0,
    queueAhead: 177,
    rate: rate(2.3),
    days: 77.4,
};

// The four quadrants as [label, value] pairs, in the order they are laid out.
function quadrants(listingUI: JQuery): [string, string][] {
    return $('.see_stats_grid .see_grid_cell', listingUI)
        .toArray()
        .map((el) => [$('.see_grid_label', el).text(), $('.see_grid_value', el).text()]);
}

beforeEach(() => {
    document.body.innerHTML = '';
});

test('the four values read across then down, with the estimate last', () => {
    const listingUI = row();

    renderListingStats(listingUI, full);

    assert.deepStrictEqual(quadrants(listingUI), [
        ['24h sold', '0'],
        ['Queue', '177'],
        ['7d avg', '2.3'],
        ['Est sell', '77d'],
    ]);
});

test('the rate label names the window the rate actually came from', () => {
    // A quiet week widens to the month, and a reader who is not told cannot compare one row
    // against another.
    const listingUI = row();

    renderListingStats(listingUI, { ...full, rate: { perDay: 2.3, windowHours: 24 * 30 } });

    assert.deepStrictEqual(quadrants(listingUI)[2], ['30d avg', '2.3']);
});

test('the grid goes in the Remove column, before the button', () => {
    // Load-bearing, not cosmetic. Steam draws .market_listing_edit_buttons as a
    // position:absolute box of exactly 50px inside a row with overflow:hidden, so anything
    // appended after the button leaves the box and the row slices it off along its bottom
    // edge -- which is what the first cut of this did.
    const listingUI = row();

    renderListingStats(listingUI, full);

    const children = $('.market_listing_cancel_button', listingUI).children().toArray();
    const grid = children.findIndex((el) => $(el).hasClass('see_stats_grid'));
    const button = children.findIndex((el) => $(el).hasClass('item_market_action_button'));

    assert.notStrictEqual(grid, -1, 'the grid is not in the Remove column at all');
    assert.ok(grid < button, 'the grid must come before the Remove button');
});

test('the cell is marked so the stylesheet can reclaim its top margin', () => {
    // .see_has_stats is what gives the grid the box's full 50px instead of the 41px left
    // under Steam's margin. Without the class the stylesheet cannot scope that to rows that
    // have a grid, and buy orders would get it too.
    const listingUI = row();

    renderListingStats(listingUI, full);

    assert.ok($('.market_listing_cancel_button', listingUI).hasClass('see_has_stats'));
});

test('the Remove button and the checkbox are left where they were', () => {
    const listingUI = row();

    renderListingStats(listingUI, full);

    assert.strictEqual(
        $('.market_listing_cancel_button .item_market_action_button', listingUI).length,
        1,
    );
    assert.strictEqual($('.market_listing_cancel_button .market_select_item', listingUI).length, 1);
});

test('what is not known is a dash, and what is zero is a zero', () => {
    const listingUI = row();

    renderListingStats(listingUI, { volume: null, queueAhead: 0, rate: null, days: null });

    assert.deepStrictEqual(quadrants(listingUI), [
        ['24h sold', '—'],
        ['Queue', '0'],
        ['7d avg', '—'],
        ['Est sell', '—'],
    ]);
});

test('the dashes carry different explanations', () => {
    // Four dashes on a row otherwise look like one failure, when they can be three different
    // ones: no history, no order book, or nothing recent enough to give a rate.
    const listingUI = row();

    renderListingStats(listingUI, { volume: null, queueAhead: null, rate: null, days: null });

    const titles = $('.see_stats_grid .see_grid_cell', listingUI)
        .toArray()
        .map((el) => $(el).attr('title'));

    assert.match(titles[0]!, /price history/);
    assert.match(titles[1]!, /order book/);
    assert.match(titles[3]!, /no estimate/i);
    assert.notStrictEqual(titles[0], titles[1]);
});

test('a queue explains that it is not counting this listing', () => {
    const listingUI = row();

    renderListingStats(listingUI, full);

    const title = $('.see_stats_grid .see_grid_cell', listingUI).eq(1).attr('title');

    assert.match(title!, /177 listed at or below your price/);
    assert.match(title!, /not counting this one/);
});

test('the estimate is painted amber past a fortnight and red past a month', () => {
    const listingUI = row();
    const estCell = () => $('.see_stats_grid .see_grid_cell', listingUI).eq(3);

    renderListingStats(listingUI, { ...full, days: 3 });
    assert.ok(!estCell().hasClass('see_sell_slow'));
    assert.ok(!estCell().hasClass('see_sell_stalled'));

    renderListingStats(listingUI, { ...full, days: 20 });
    assert.ok(estCell().hasClass('see_sell_slow'));
    assert.ok(!estCell().hasClass('see_sell_stalled'));

    renderListingStats(listingUI, { ...full, days: 104 });
    assert.ok(estCell().hasClass('see_sell_stalled'));
    assert.ok(!estCell().hasClass('see_sell_slow'));
});

test('only the estimate is painted, and never when it is a dash', () => {
    const listingUI = row();

    renderListingStats(listingUI, { volume: null, queueAhead: null, rate: null, days: null });

    assert.strictEqual($('.see_sell_slow, .see_sell_stalled', listingUI).length, 0);
});

test('a repricing that turns the estimate healthy takes the warning back off', () => {
    // The class is written onto a cell the render rebuilds each pass, so this is really
    // pinning that the rebuild is a replacement rather than a patch.
    const listingUI = row();

    renderListingStats(listingUI, { ...full, days: 104 });
    renderListingStats(listingUI, { ...full, days: 2 });

    assert.strictEqual($('.see_sell_slow, .see_sell_stalled', listingUI).length, 0);
});

test('pricing a row twice replaces the grid rather than stacking one under it', () => {
    // The queue retries a failed listing once with ignoreErrors set, so both attempts reach
    // the render -- the same reason renderPriceCellGrid is idempotent.
    const listingUI = row();

    renderListingStats(listingUI, full);
    renderListingStats(listingUI, { ...full, queueAhead: 3, days: 2 });

    assert.strictEqual($('.see_stats_grid', listingUI).length, 1);
    assert.deepStrictEqual(quadrants(listingUI)[1], ['Queue', '3']);
    assert.deepStrictEqual(quadrants(listingUI)[3], ['Est sell', '2d']);
});

test('a row with no Remove column is left alone rather than thrown over', () => {
    // Buy order rows and confirmation rows are not shaped like a sell listing.
    document.body.innerHTML = '<div class="market_listing_row"></div>';
    const listingUI = $('.market_listing_row');

    renderListingStats(listingUI, full);

    assert.strictEqual($('.see_stats_grid', listingUI).length, 0);
});
