// sortMarketListings' column resolution.
//
// The sort is bound in market/ui.ts with a delegated .on('click', 'span', ...), so a click
// on a span nested inside a header span fires the handler twice -- once with the inner span
// as `this`, where the section walk lands on the header rather than the section and all
// three column flags come back false. There was no else branch for that case, so it threw.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import '../src/vendor/jquery-observe.js';
import { sortMarketListings } from '../src/market/sort.ts';
import { marketLists } from '../src/market/rows.ts';
import { addMarketListings } from '../src/market/listings.ts';

// A .market_home_listing_table with a table header and one registered row, which is the
// minimum sortMarketListings needs: getListFromContainer must find a list for the section,
// or it returns before ever reaching the column resolution.
function tableWithHeader(headerHtml: string): JQuery {
    document.body.innerHTML = `
        <div class="market_home_listing_table">
            <div class="market_listing_table_header">${headerHtml}</div>
            <div class="market_listing_see"></div>
        </div>`;

    const rowsContainer = $('.market_listing_see');
    rowsContainer.append(`<div class="market_listing_row">
        <span class="market_listing_game_name">Game</span>
        <a class="market_listing_item_name_link">Item</a>
        <span class="market_listing_price">1,00€</span>
        <span class="market_listing_listed_date">1 Jan</span>
        <span class="market_listing_item_name" id="mylisting_111_name"></span>
    </div>`);
    addMarketListings(rowsContainer);

    return $('.market_home_listing_table');
}

beforeEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = '';
});

test('a click matching no column is ignored rather than throwing', () => {
    const table = tableWithHeader('<span>Name</span>');

    assert.doesNotThrow(() => sortMarketListings(table, false, false, false));
});

test('a click matching no column appends no arrow', () => {
    const table = tableWithHeader('<span>Name</span>');

    sortMarketListings(table, false, false, false);

    assert.strictEqual($('.market_listing_table_header', table).text().includes('▲'), false);
    assert.strictEqual($('.market_listing_table_header', table).text().includes('▼'), false);
});

// The four-column shape Steam actually renders: the sort reads children().eq(1..3), so a
// header with only one span leaves every column lookup empty even when a flag is set.
test('a set flag whose column is not in the header is ignored rather than throwing', () => {
    const table = tableWithHeader('<span>Only one column</span>');

    assert.doesNotThrow(() => sortMarketListings(table, true, false, false));
});

test('a matched column still gets its arrow', () => {
    const table = tableWithHeader(
        '<span>Buttons</span><span>Price</span><span>Date</span><span>Name</span>',
    );

    sortMarketListings(table, true, false, false);

    assert.strictEqual($('.market_listing_table_header', table).children().eq(1).text(), 'Price ▲');
});

// --- the date and quantity comparators ----------------------------------------------------
//
// Steam renders a listing's date as 'd MMM' with no year, so the comparator rolls a month
// later than the current one back to last year. Three things were wrong with it:
//
//   - `firstDate === secondDate` compares DateTime *references*, so it was never true. Two
//     equal dates returned -1 in both directions, and Array.prototype.sort with an
//     inconsistent comparator has implementation-defined output.
//   - `if (firstDate == null)` never fired: DateTime.fromFormat returns an *invalid* DateTime
//     on a parse failure, never null, so an unparseable date propagated as NaN.
//   - the buy-order branch subtracted two innerText strings, which is fine for '12' and NaN
//     for '1,234'.

// A row carrying the values list.js indexes, with the listed date and quantity under test.
function dateRow(listingId: string, listedDate: string, quantity?: string): string {
    return `<div class="market_listing_row">
        <span class="market_listing_game_name">Game</span>
        <a class="market_listing_item_name_link">Item ${listingId}</a>
        <span class="market_listing_price">1,00€</span>
        <span class="market_listing_listed_date">${listedDate}</span>
        ${quantity == null ? '' : `<span class="market_listing_buyorder_qty">${quantity}</span>`}
        <span class="market_listing_item_name" id="mylisting_${listingId}_name"></span>
    </div>`;
}

function tableWithRows(rows: string[]): JQuery {
    document.body.innerHTML = `
        <div class="market_home_listing_table">
            <div class="market_listing_table_header">
                <span>Buttons</span><span>Price</span><span>Date</span><span>Name</span>
            </div>
            <div class="market_listing_see"></div>
        </div>`;

    const rowsContainer = $('.market_listing_see');
    rows.forEach((row) => rowsContainer.append(row));
    addMarketListings(rowsContainer);

    return $('.market_home_listing_table');
}

// The order the rows are actually in on the page after the sort.
function renderedItemNames(): string[] {
    return $('.market_listing_row .market_listing_item_name_link')
        .map(function () {
            return $(this).text();
        })
        .get();
}

test('listings with the same date sort deterministically, not arbitrarily', () => {
    // The reference-equality bug: `first === second` is never true for two DateTimes, so equal
    // dates reported -1 in both directions. Running the same sort twice is what catches it.
    const table = tableWithRows([
        dateRow('111', '1 Feb'),
        dateRow('222', '1 Feb'),
        dateRow('333', '1 Feb'),
    ]);

    sortMarketListings(table, false, true, false);
    const first = renderedItemNames();

    sortMarketListings(table, false, true, false);
    sortMarketListings(table, false, true, false);
    const later = renderedItemNames();

    assert.deepStrictEqual(first, later, 'a stable comparator gives the same order every time');
});

test('an unparseable date does not throw or reorder the rest', () => {
    const table = tableWithRows([
        dateRow('111', '1 Feb'),
        dateRow('222', 'not a date'),
        dateRow('333', '2 Feb'),
    ]);

    assert.doesNotThrow(() => sortMarketListings(table, false, true, false));
    assert.strictEqual(renderedItemNames().length, 3, 'no row is lost');
});

test('dates sort oldest first ascending', () => {
    const table = tableWithRows([
        dateRow('333', '3 Feb'),
        dateRow('111', '1 Feb'),
        dateRow('222', '2 Feb'),
    ]);

    sortMarketListings(table, false, true, false);

    assert.deepStrictEqual(renderedItemNames(), ['Item 111', 'Item 222', 'Item 333']);
});

test('a buy-order quantity with a thousands separator is compared as a number', () => {
    // `'1,234' - '20'` is NaN, which makes the whole sort implementation-defined.
    const table = tableWithRows([
        dateRow('111', '1 Feb', '1,234'),
        dateRow('222', '1 Feb', '20'),
        dateRow('333', '1 Feb', '105'),
    ]);

    sortMarketListings(table, false, true, false);

    assert.deepStrictEqual(renderedItemNames(), ['Item 222', 'Item 333', 'Item 111']);
});
