'use strict';

// A second steamPage adapter, built from data instead of a real page.
//
// AGENT-2's plan is explicit that one adapter is a hypothetical seam - the point of a fixture
// adapter is that the shape this file expects Steam's page to have can be pinned down and a
// change to it caught by a test, the way PR #334's bug (a "listings awaiting confirmation"
// block silently breaking which header the sell listings buttons attached to) was not.
//
// This is not a real DOM. There is no DOM/HTML-parsing library anywhere in this repo, and
// _SHARED-RULES.md is explicit that a plan's tests must run with `node --test` and no new
// runtime dependency, so one cannot be added here either. A fixture is instead a plain
// description of a market page's shape: which "market_home_listing_table" sections exist,
// in DOM order, and which one (if any) holds the sell listings table Steam's own markup
// anchors it by id.
//
// { sections: [{ id, hasSellListingsTable }, ...] }
//
// A page with a pending-confirmations block ahead of the sell listings - the PR #334 shape -
// is `{ sections: [{ id: 'header-confirmations', hasSellListingsTable: false }, { id:
// 'header-sell-listings', hasSellListingsTable: true }] }`.
function createFixtureSteamPage(fixture, { pickSellListingsHeader }) {
    const sellListingsSection = fixture.sections.find((section) => section.hasSellListingsTable);
    const anchored = sellListingsSection ? [sellListingsSection.id] : [];
    const all = fixture.sections.map((section) => section.id);

    return {
        sellListingsHeader: () => pickSellListingsHeader(anchored, all)
    };
}

module.exports = { createFixtureSteamPage };
