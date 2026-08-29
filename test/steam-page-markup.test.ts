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
