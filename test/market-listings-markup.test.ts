// The duplicate/confirmation sweep in onMarketListingsItemsDrained, against markup that is
// missing the pieces the code used to assert were always there.
//
// This is the PR #334 class that CLAUDE.md documents and the steamPage seam exists to stop:
// `$('.item_market_action_button', this).attr('href')!` asserted every row carries a market
// action button. A row without one threw *inside* the .each(), which abandoned every
// remaining row -- so the duplicate and confirmation rows this loop exists to remove stayed
// on the page, with nothing in the console to say why.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import '../src/vendor/jquery-observe.js';
import '../src/vendor/jquery.checkboxes.js';
import { onMarketListingsItemsDrained } from '../src/market/listings.ts';
import { marketLists } from '../src/market/rows.ts';

// A row as Steam renders it. `href` omitted entirely models the row shape that used to throw.
function listingRow(id: string, href: string | null): string {
    const button =
        href === null
            ? '<a class="item_market_action_button">Remove</a>'
            : `<a class="item_market_action_button" href="${href}">Remove</a>`;

    return `<div class="market_listing_row" id="${id}">${button}</div>`;
}

function render(rows: string[]) {
    document.body.innerHTML = `
        <div class="market_home_listing_table">
            <div id="tabContentsMyActiveMarketListingsRows">${rows.join('\n')}</div>
        </div>`;
}

beforeEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = '';
});

test('a row with no href does not abandon the rest of the sweep', () => {
    render([
        listingRow('mylisting_1', null),
        listingRow('mylisting_2', 'javascript:CancelMarketListingConfirmation(1)'),
        listingRow('mylisting_3', 'javascript:CancelMarketBuyOrder(2)'),
        listingRow('mylisting_4', 'javascript:CancelMarketListing(3)'),
    ]);

    assert.doesNotThrow(() => onMarketListingsItemsDrained());

    // The hrefless row survives -- nothing identifies it as a confirmation or a buy order --
    // and, crucially, the two rows *after* it were still swept.
    const remaining = $('.market_listing_row')
        .map(function () {
            return $(this).attr('id');
        })
        .get();

    assert.deepStrictEqual(remaining, ['mylisting_1', 'mylisting_4']);
});

test('confirmation and buy-order rows are removed, ordinary listings are kept', () => {
    render([
        listingRow('mylisting_1', 'javascript:CancelMarketListing(1)'),
        listingRow('mylisting_2', 'javascript:CancelMarketListingConfirmation(2)'),
        listingRow('mylisting_3', 'javascript:CancelMarketBuyOrder(3)'),
    ]);

    onMarketListingsItemsDrained();

    assert.strictEqual($('#mylisting_1').length, 1);
    assert.strictEqual($('#mylisting_2').length, 0);
    assert.strictEqual($('#mylisting_3').length, 0);
});

test('a duplicate id is removed once and does not stop the sweep', () => {
    render([
        listingRow('mylisting_1', 'javascript:CancelMarketListing(1)'),
        listingRow('mylisting_1', 'javascript:CancelMarketListing(1)'),
        listingRow('mylisting_2', 'javascript:CancelMarketListingConfirmation(2)'),
    ]);

    onMarketListingsItemsDrained();

    assert.strictEqual($('#mylisting_1').length, 1);
    assert.strictEqual($('#mylisting_2').length, 0);
});

// The duplicate branch now returns before reading the href. A duplicate row that also has no
// href used to reach the assertion and throw; it must simply be removed.
test('a duplicate row with no href is removed without throwing', () => {
    render([
        listingRow('mylisting_1', 'javascript:CancelMarketListing(1)'),
        listingRow('mylisting_1', null),
        listingRow('mylisting_2', 'javascript:CancelMarketListing(2)'),
    ]);

    assert.doesNotThrow(() => onMarketListingsItemsDrained());

    assert.strictEqual($('.market_listing_row').length, 2);
});
