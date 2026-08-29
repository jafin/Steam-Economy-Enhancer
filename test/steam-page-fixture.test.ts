import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

import { createFixtureSteamPage } from './steam-page-fixture.ts';


function fixturePage(fixture) {
    return createFixtureSteamPage(fixture, { pickSellListingsHeader: see.pickSellListingsHeader });
}

// The PR #334 bug class: Steam changed which DOM element the sell listings' header actually
// was, and a naive $('.my_market_header').first() picked the wrong one - the Select/Relist
// buttons silently attached to a "listings awaiting confirmation" block instead. No error,
// no failing request, just buttons that appeared on the wrong table.

test('PR #334 shape: a pending-confirmations header ahead of the sell listings does not steal the buttons', () => {
    const page = fixturePage({
        sections: [
            { id: 'header-confirmations', hasSellListingsTable: false },
            { id: 'header-sell-listings', hasSellListingsTable: true }
        ]
    });

    assert.strictEqual(
        page.sellListingsHeader(),
        'header-sell-listings',
        'the anchored header, not whichever one is first in DOM order'
    );
});

test('a page with only the sell listings header still works', () => {
    const page = fixturePage({
        sections: [
            { id: 'header-sell-listings', hasSellListingsTable: true }
        ]
    });

    assert.strictEqual(page.sellListingsHeader(), 'header-sell-listings');
});

test('when Steam changes the markup so the sell listings table cannot be found at all, the first header is used rather than none', () => {
    // The second bug 1e6fec9 fixed: an anchor that finds nothing must not leave the buttons
    // with nowhere to go, because $(header).not(sellListingsHeader) then matches every
    // header and gives the sell listings the "confirmations" button set instead.
    const page = fixturePage({
        sections: [
            { id: 'header-confirmations', hasSellListingsTable: false },
            { id: 'header-buyorders', hasSellListingsTable: false }
        ]
    });

    assert.strictEqual(
        page.sellListingsHeader(),
        'header-confirmations',
        'falls back to the first header rather than an empty set'
    );
});

test('the live adapter and the fixture adapter make the same call from the same shape', () => {
    // Both adapters route the actual decision through the one shared function
    // (pickSellListingsHeader), so this is really pinning that the fixture's "which section
    // holds the sell listings table" shape produces the same anchored/all inputs a real
    // $('#tabContentsMyActiveMarketListingsRows').closest(...).find(...) lookup would.
    const anchoredFound = see.pickSellListingsHeader(['header-sell-listings'], ['header-confirmations', 'header-sell-listings']);
    const page = fixturePage({
        sections: [
            { id: 'header-confirmations', hasSellListingsTable: false },
            { id: 'header-sell-listings', hasSellListingsTable: true }
        ]
    });

    assert.strictEqual(page.sellListingsHeader(), anchoredFound);
});
