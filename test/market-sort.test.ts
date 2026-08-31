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
