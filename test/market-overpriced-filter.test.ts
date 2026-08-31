// The "Overpriced only" checkbox in the sell listings button row.
//
// The filter selects on the `overpriced` class, which the pricing pass writes one row at a
// time, while list.js decides membership when filter() runs and caches it on the item. So
// the two things worth pinning are that ticking the box hides the rows that are not
// overpriced, and that a row priced *after* the box was ticked still joins the filter --
// the case a filter applied only on the change event would get wrong.
//
// Built by calling initializeMarketUI() and addMarketListings() for real, the way
// test/market-selection.test.ts does, so a change to the button row or the list options is
// caught here rather than by a hand-copied markup string that has drifted.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import '../src/vendor/jquery-observe.js';
import { VERDICT_OVERPRICED } from '../src/constants.ts';
import { addMarketListings } from '../src/market/listings.ts';
import { updateMarketOverpricedButtons } from '../src/market/relist.ts';
import { getListingFromLists, marketLists } from '../src/market/rows.ts';
import { selectionFor } from '../src/market/selection.ts';
import { initializeMarketUI } from '../src/market/ui.ts';

function section(): string {
    return `
        <div class="market_home_listing_table">
            <div class="my_market_header" id="header-sell-listings">header</div>
            <div id="tabContentsMyActiveMarketListingsRows"></div>
        </div>`;
}

// Carries the select checkbox addMarketCheckboxes() would add in production. It runs from
// initializeMarketUI(), which is before these rows exist, so the markup brings its own.
function row(listingId: string): string {
    return `<div class="market_listing_row">
        <span class="market_listing_game_name">Game</span>
        <a class="market_listing_item_name_link">Item ${listingId}</a>
        <span class="market_listing_price">1,00€</span>
        <span class="market_listing_listed_date">1 Jan</span>
        <span class="market_listing_item_name" id="mylisting_${listingId}_name"></span>
        <div class="market_listing_cancel_button">
            <div class="market_listing_select"><input type="checkbox" class="market_select_item"/></div>
        </div>
    </div>`;
}

function registerRows(listingIds: string[]) {
    const sectionEl = $('#header-sell-listings').closest('.market_home_listing_table');
    const rowsContainer = $('.market_listing_see', sectionEl).last();
    listingIds.forEach((id) => rowsContainer.append(row(id)));
    addMarketListings(rowsContainer);
}

function checkbox(): JQuery {
    return $('#header-sell-listings').find('.market_overpriced_filter');
}

// The change handler is bound to the checkbox itself, so a click inside it is not needed --
// but the event has to be the one ui.ts listens for.
function toggleFilter(on: boolean) {
    checkbox().prop('checked', on).trigger('change');
}

function matchingListingIds(): string[] {
    const selection = selectionFor(checkbox().get(0));
    assert.notStrictEqual(selection, null, 'the filter checkbox resolved no list');

    return selection!.rows.map((item) =>
        $('.market_listing_item_name', item.elm).attr('id')!.replace(/\D/g, ''),
    );
}

// What the pricing pass does to a row it has just priced. Through the registry rather than a
// DOM lookup, because that is how listings.ts reaches the row -- and it has to be: a row the
// filter has already hidden is detached from the document, so an id selector would not find it.
function markOverpriced(listingId: string) {
    const listing = getListingFromLists(listingId);
    assert.notStrictEqual(listing, undefined, `no registered row for listing ${listingId}`);

    $(listing.elm).addClass(VERDICT_OVERPRICED);
}

beforeEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = section();
    initializeMarketUI();
    registerRows(['111', '222', '333']);
});

test('the sell listings button row carries the overpriced filter checkbox', () => {
    assert.strictEqual(checkbox().length, 1);
    assert.strictEqual(checkbox().is(':checked'), false, 'the filter starts off');
});

test('ticking the box leaves only the overpriced listings matching', () => {
    markOverpriced('222');

    toggleFilter(true);

    assert.deepStrictEqual(matchingListingIds(), ['222']);
});

test('unticking the box brings the other listings back', () => {
    markOverpriced('222');

    toggleFilter(true);
    toggleFilter(false);

    assert.deepStrictEqual(matchingListingIds(), ['111', '222', '333']);
});

test('a listing priced after the box was ticked joins the filter', () => {
    // The pricing pass marks a row overpriced and then refreshes the buttons; nothing
    // re-runs the change handler, so this is the path that has to re-apply the filter.
    markOverpriced('222');
    toggleFilter(true);

    markOverpriced('333');
    updateMarketOverpricedButtons();

    assert.deepStrictEqual(matchingListingIds(), ['222', '333']);
});

test('the overpriced counts describe the filtered list', () => {
    markOverpriced('222');
    toggleFilter(true);
    updateMarketOverpricedButtons();

    const section = $('#header-sell-listings').closest('.market_home_listing_table');
    assert.strictEqual($('.select_overpriced > span', section).text(), 'Select overpriced (1)');
    assert.strictEqual($('.relist_overpriced > span', section).text(), 'Relist overpriced (1)');
});

test('select all under the filter leaves the hidden listings alone', () => {
    // "Select all", "Relist selected" and "Remove selected" all walk matchingItems, so the
    // filter reaching that set is what keeps them off the rows the user cannot see.
    markOverpriced('222');
    const hidden = $('#mylisting_111_name').closest('.market_listing_row');

    toggleFilter(true);
    $('#header-sell-listings')
        .find('.select_all .item_market_action_button_contents')
        .trigger('click');

    const shown = $('#mylisting_222_name').closest('.market_listing_row');

    assert.strictEqual($('.market_select_item', shown).prop('checked'), true);
    assert.notStrictEqual(
        $('.market_select_item', hidden).prop('checked'),
        true,
        'select all ticked a listing the filter had hidden',
    );
});
