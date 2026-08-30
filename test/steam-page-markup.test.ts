import { test, beforeEach } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// The live adapter against real markup.
//
// test/steam-page-fixture.ts describes a market page's shape as data. That fixture exists
// because the shape needs pinning down, but on its own it proves only that
// pickSellListingsHeader behaves -- not that a real page produces the anchored/all inputs
// the fixture claims it does. happy-dom closes that gap: these tests build the actual
// markup and run the same $('#tabContentsMyActiveMarketListingsRows').closest(...).find(...)
// lookup the browser runs, so the two adapters now check each other rather than the fixture
// standing alone.
//
// The old node --test harness could not do this: it had no DOM, which is exactly why the
// fixture was written as data in the first place.

// One `.market_home_listing_table` section. `withSellListings` places the rows container
// Steam anchors the sell listings by inside it.
function section(id: string, withSellListings: boolean): string {
    return `
        <div class="market_home_listing_table">
            <div class="my_market_header" id="${id}">header</div>
            ${withSellListings ? '<div id="tabContentsMyActiveMarketListingsRows"></div>' : ''}
        </div>`;
}

function render(...sections: string[]): void {
    document.body.innerHTML = sections.join('\n');
}

beforeEach(() => {
    document.body.innerHTML = '';
});

test('PR #334 shape in real markup: the confirmations header does not steal the buttons', () => {
    render(section('header-confirmations', false), section('header-sell-listings', true));

    const header = see.createSteamPage({}).sellListingsHeader();

    assert.strictEqual(
        header.attr('id'),
        'header-sell-listings',
        'the header anchored to the sell listings table, not the first in DOM order',
    );
});

test('with only the sell listings section present, that header is chosen', () => {
    render(section('header-sell-listings', true));

    assert.strictEqual(
        see.createSteamPage({}).sellListingsHeader().attr('id'),
        'header-sell-listings',
    );
});

test('when no section holds the sell listings table, the first header is used rather than none', () => {
    render(section('header-confirmations', false), section('header-buyorders', false));

    const header = see.createSteamPage({}).sellListingsHeader();

    assert.strictEqual(header.attr('id'), 'header-confirmations');
    assert.strictEqual(header.length, 1, 'exactly one header, never an empty set');
});

// Inventory selection. selection.ts used to walk .inventory_ctn -> .inventory_page ->
// .itemHolder.ui-selected -> .item and pull the asset id off the trailing number in the
// id, straight out of the DOM. That walk now lives in createSteamPage's selectedAssetIds();
// these tests pin it against the same markup shape test/inventory-selection.test.ts already
// builds for the click/Ctrl/Shift side.
function itemHolder(assetId: string, { selected = false, hiddenBySearch = false } = {}) {
    const classes = ['itemHolder', selected ? 'ui-selected' : ''].filter(Boolean).join(' ');
    const style = hiddenBySearch ? ' style="display: none;"' : '';
    return `<div class="${classes}"${style}><div id="730_2_${assetId}" class="item"></div></div>`;
}

function inventoryPage(itemHolders: string, { hidden = false } = {}): string {
    const style = hidden ? ' style="display: none;"' : '';
    return `<div class="inventory_page"${style}>${itemHolders}</div>`;
}

function renderInventory(...pages: string[]): void {
    document.body.innerHTML = `<div class="inventory_ctn">${pages.join('\n')}</div>`;
}

test('selectedAssetIds reads the ui-selected class back off the DOM', () => {
    renderInventory(inventoryPage(itemHolder('111', { selected: true }) + itemHolder('222')));

    assert.deepStrictEqual(see.createSteamPage({}).selectedAssetIds(), ['111']);
});

test('selectedAssetIds skips a selected item Steam has hidden while searching', () => {
    renderInventory(
        inventoryPage(
            itemHolder('111', { selected: true }) +
                itemHolder('222', { selected: true, hiddenBySearch: true }),
        ),
    );

    assert.deepStrictEqual(see.createSteamPage({}).selectedAssetIds(), ['111']);
});

test('selectedAssetIds does not filter by the page itself being hidden -- only the item holder', () => {
    // Two selected items, one of them on a page Steam has hidden (the other page of the
    // inventory, not currently on screen). getSelectedItems() only ever checked the
    // itemHolder's own style, never the page's, so this is what it has always returned --
    // pinned here so a future change to it is deliberate, not silent.
    renderInventory(
        inventoryPage(itemHolder('111', { selected: true })),
        inventoryPage(itemHolder('222', { selected: true }), { hidden: true }),
    );

    assert.deepStrictEqual(see.createSteamPage({}).selectedAssetIds(), ['111', '222']);
});

// itemInfoPanel / itemOwnerActions. ui.ts used to reach for these directly --
// $('#iteminfo' + activeSelectView()) and baseLink.parent().parent() -- which is the PR #334
// shape again: change how many levels separate the market listing anchor from the container
// the quick-sell buttons attach to, and they attach to the wrong element without an error.
function itemInfoPanel(view: number, marketLink: string): string {
    return `
        <div id="iteminfo${view}">
            <div class="item_market_actions">
                <div class="market_actionable">
                    <a href="${marketLink}">See listings</a>
                </div>
            </div>
        </div>`;
}

test('itemInfoPanel finds the panel for the active select view', () => {
    render(
        itemInfoPanel(
            0,
            'https://steamcommunity.com/market/listings/440/Mann Co. Supply Crate Key',
        ),
    );

    const panel = see.createSteamPage({ iActiveSelectView: 0 }).itemInfoPanel();

    assert.strictEqual(panel.attr('id'), 'iteminfo0');
});

test('itemInfoPanel does not find a panel for a different select view', () => {
    render(
        itemInfoPanel(
            1,
            'https://steamcommunity.com/market/listings/440/Mann Co. Supply Crate Key',
        ),
    );

    const panel = see.createSteamPage({ iActiveSelectView: 0 }).itemInfoPanel();

    assert.strictEqual(panel.length, 0);
});

test('itemOwnerActions walks up from the market listing anchor to its owning container', () => {
    const marketLink = 'https://steamcommunity.com/market/listings/440/Mann Co. Supply Crate Key';
    render(itemInfoPanel(0, marketLink));

    const page = see.createSteamPage({ iActiveSelectView: 0 });
    const ownerActions = page.itemOwnerActions(page.itemInfoPanel(), marketLink);

    assert.strictEqual(
        ownerActions.hasClass('item_market_actions'),
        true,
        'two parents above the anchor is the item_market_actions container',
    );
});

test('itemOwnerActions is scoped to the given panel, not the whole document', () => {
    // Two panels for two select views, as Steam renders per item. A lookup that was not
    // scoped to the panel passed in would find the first matching anchor anywhere on the
    // page rather than the one in this item's own panel.
    const marketLink = 'https://steamcommunity.com/market/listings/440/Mann Co. Supply Crate Key';
    render(
        `<div id="owner-actions-0" class="item_market_actions"><div class="market_actionable"><a href="${marketLink}">See listings</a></div></div>`,
        itemInfoPanel(1, marketLink),
    );

    const page = see.createSteamPage({ iActiveSelectView: 1 });
    const ownerActions = page.itemOwnerActions(page.itemInfoPanel(), marketLink);

    assert.strictEqual(ownerActions.attr('id'), undefined);
    assert.strictEqual(ownerActions.hasClass('item_market_actions'), true);
});

test('real markup and the fixture agree on which header wins', () => {
    // The point of keeping both adapters. If Steam's markup changes so that the live lookup
    // starts producing different anchored/all inputs, this is the test that notices -- the
    // fixture alone would carry on passing against a shape the page no longer has.
    const sections = [
        { id: 'header-confirmations', hasSellListingsTable: false },
        { id: 'header-sell-listings', hasSellListingsTable: true },
    ];

    render(...sections.map((s) => section(s.id, s.hasSellListingsTable)));

    const fromMarkup = see.createSteamPage({}).sellListingsHeader().attr('id');
    const fromFixture = see.pickSellListingsHeader(
        sections.filter((s) => s.hasSellListingsTable).map((s) => s.id),
        sections.map((s) => s.id),
    );

    assert.strictEqual(fromMarkup, fromFixture);
});
