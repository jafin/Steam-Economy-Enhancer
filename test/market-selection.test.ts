// The market buttons' selection resolution -- the PR #334 failure class reappearing inside
// the market region (TASK-05). Every button handler in src/market/ui.ts walks up from the
// click target by a fixed number of parents to find the section it acts on, then asks the
// registry which list that is. Two different depths (four parents from a click buried
// inside a button, two from the buttons block or the table header) have to agree with the
// markup initializeMarketUI() actually writes, and nothing checked that they did.
//
// This builds that markup by calling initializeMarketUI() itself, exactly the way
// test/steam-page-markup.test.ts builds real markup to pin sellListingsHeader() -- so a
// future change to the button nesting is caught here, not by a hand-copied HTML string that
// could quietly drift out of sync with it.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
// initializeMarketUI() ends by calling initializeMarketHistoryUI(), which uses the
// jquery-observe plugin. src/main.ts is what registers it onto jQuery in production; this
// test imports ui.ts directly rather than main.ts, so it has to register the plugin itself.
import '../src/vendor/jquery-observe.js';
import { initializeMarketUI } from '../src/market/ui.ts';
import { addMarketListings } from '../src/market/listings.ts';
import { marketLists } from '../src/market/rows.ts';
import { marketSectionFor, selectionFor, tableHeaderSectionFor } from '../src/market/selection.ts';

// One .market_home_listing_table section, in the shape steamPage.sellListingsHeader() and
// fillMarketListingsQueue() (src/market/listings.ts) both key off: a .my_market_header, and
// -- only for the section holding the sell listings -- the #tabContentsMyActiveMarketListingsRows
// anchor that decides which header initializeMarketUI() treats as the sell listings one.
function section(headerId: string, isSellListingsSection: boolean): string {
    return `
        <div class="market_home_listing_table">
            <div class="my_market_header" id="${headerId}">header</div>
            ${isSellListingsSection ? '<div id="tabContentsMyActiveMarketListingsRows"></div>' : ''}
        </div>`;
}

// Matches the shape addMarketListings() expects: a row whose listing id lives in the
// 'market_listing_item_name' id attribute, plus the other valueNames it registers so list.js
// has something to read for each of them.
function row(listingId: string): string {
    return `<div class="market_listing_row">
        <span class="market_listing_game_name">Game</span>
        <a class="market_listing_item_name_link">Item ${listingId}</a>
        <span class="market_listing_price">1,00€</span>
        <span class="market_listing_listed_date">1 Jan</span>
        <span class="market_listing_item_name" id="mylisting_${listingId}_name"></span>
    </div>`;
}

// Registers a list of the given size on the rows container initializeMarketUI() (by way of
// processMarketListings() -> fillMarketListingsQueue()) already created inside `sectionEl` --
// the same container addMarketListings() registers a list on in production. This calls the
// real addMarketListings() rather than a hand-rolled List() construction, and skips only the
// sort that fillMarketListingsQueue() would otherwise run over rows that do not carry the
// game-name and item-name-link values it sorts by.
function registerRows(sectionEl: JQuery, listingIds: string[]) {
    const rowsContainer = $('.market_listing_see', sectionEl).last();
    listingIds.forEach((id) => rowsContainer.append(row(id)));
    addMarketListings(rowsContainer);
}

beforeEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = '';
});

test('select_all on the sell-listings section resolves that section, not another one', () => {
    document.body.innerHTML =
        section('header-sell-listings', true) + section('header-confirmations', false);

    initializeMarketUI();

    registerRows($('#header-sell-listings').closest('.market_home_listing_table'), ['111', '222']);
    registerRows($('#header-confirmations').closest('.market_home_listing_table'), ['333']);

    const target = $('#header-sell-listings')
        .find('.select_all .item_market_action_button_contents')
        .get(0);

    const selection = selectionFor(target);

    assert.notStrictEqual(
        selection,
        null,
        'selectionFor found no list for the sell-listings button',
    );
    assert.strictEqual(selection!.rows.length, 2);
});

test('select_all on the confirmations section resolves its own list, not the sell-listings one', () => {
    document.body.innerHTML =
        section('header-sell-listings', true) + section('header-confirmations', false);

    initializeMarketUI();

    registerRows($('#header-sell-listings').closest('.market_home_listing_table'), ['111', '222']);
    registerRows($('#header-confirmations').closest('.market_home_listing_table'), ['333']);

    const target = $('#header-confirmations')
        .find('.select_all .item_market_action_button_contents')
        .get(0);

    const selection = selectionFor(target);

    assert.notStrictEqual(
        selection,
        null,
        'selectionFor found no list for the confirmations button',
    );
    assert.strictEqual(selection!.rows.length, 1);
});

// The seven four-parent handlers in ui.ts all live in the same .market_listing_buttons
// block, so they all have to resolve to the same section.
const sellListingsOnlyButtons = ['select_five_from_page', 'select_twentyfive_from_page'];
const sharedButtons = [
    'select_all',
    'select_overpriced',
    'remove_selected',
    'relist_overpriced',
    'relist_selected',
];

for (const buttonClass of [...sellListingsOnlyButtons, ...sharedButtons]) {
    test(`${buttonClass} resolves the section its button lives in`, () => {
        document.body.innerHTML =
            section('header-sell-listings', true) + section('header-confirmations', false);

        initializeMarketUI();

        registerRows($('#header-sell-listings').closest('.market_home_listing_table'), [
            '111',
            '222',
        ]);
        registerRows($('#header-confirmations').closest('.market_home_listing_table'), ['333']);

        const target = $('#header-sell-listings')
            .find(`.${buttonClass} .item_market_action_button_contents`)
            .get(0);

        const selection = selectionFor(target);

        assert.notStrictEqual(selection, null, `selectionFor found no list for .${buttonClass}`);
        assert.strictEqual(selection!.rows.length, 2);
    });
}

test('selectionFor resolves the same target whether the click landed on the label or the button itself', () => {
    // The handlers are bound with .on('click', '*', ...), so `this` is the descendant that
    // was clicked -- normally the label span -- not the <a> button. selectionFor must
    // resolve to the same place regardless of which one it is handed.
    document.body.innerHTML = section('header-sell-listings', true);
    initializeMarketUI();
    registerRows($('#header-sell-listings').closest('.market_home_listing_table'), ['111']);

    const anchor = $('#header-sell-listings').find('.select_all').get(0);
    const label = $('#header-sell-listings')
        .find('.select_all .item_market_action_button_contents')
        .get(0);

    const fromAnchor = selectionFor(anchor);
    const fromLabel = selectionFor(label);

    assert.notStrictEqual(fromAnchor, null);
    assert.notStrictEqual(fromLabel, null);
    assert.strictEqual(fromAnchor!.group.get(0), fromLabel!.group.get(0));
});

test('selectionFor returns null when the section has no list registered yet', () => {
    // An empty buy-orders block, for instance: initializeMarketUI() writes its buttons
    // unconditionally, but addMarketListings() is only ever called for a section that has
    // rows -- see fillMarketListingsQueue()'s childElementCount guard.
    document.body.innerHTML = section('header-sell-listings', true);
    initializeMarketUI();

    const target = $('#header-sell-listings')
        .find('.select_all .item_market_action_button_contents')
        .get(0);

    assert.strictEqual(selectionFor(target), null);
});

test('marketSectionFor resolves the section for a target that is the buttons block itself', () => {
    // updateMarketSelectAllButton iterates .market_listing_buttons directly, so `target` is
    // the buttons block, not a click descendant inside it -- two parents up, not four.
    document.body.innerHTML = section('header-sell-listings', true);
    initializeMarketUI();

    const buttons = $('#header-sell-listings').find('.market_listing_buttons').get(0);
    const table = $('#header-sell-listings').closest('.market_home_listing_table').get(0);

    assert.strictEqual(marketSectionFor(buttons).get(0), table);
});

test('tableHeaderSectionFor resolves the section for a click inside the table header', () => {
    // .market_listing_table_header is Steam's own markup, a direct child of
    // .market_home_listing_table sitting beside .my_market_header -- addMarketListings()
    // looks it up the same way, via market_listing_see.parent(). Built by hand here since
    // initializeMarketUI() does not create it; Steam's page does.
    document.body.innerHTML = section('header-sell-listings', true);
    initializeMarketUI();
    registerRows($('#header-sell-listings').closest('.market_home_listing_table'), ['111']);

    const table = $('#header-sell-listings').closest('.market_home_listing_table');
    const header = $('<div class="market_listing_table_header"></div>').appendTo(table);
    const headerSpan = $('<span>Price</span>').appendTo(header);

    assert.strictEqual(tableHeaderSectionFor(headerSpan.get(0)).get(0), table.get(0));
});
