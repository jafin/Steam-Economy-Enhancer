// A second steamPage adapter, built from data instead of a real page.
//
// AGENT-2's plan is explicit that one adapter is a hypothetical seam. The point of a fixture
// adapter is that the shape this file expects Steam's page to have can be pinned down and a
// change to it caught by a test, the way PR #334's bug (a "listings awaiting confirmation"
// block silently breaking which header the sell listings buttons attached to) was not.
//
// This file originally carried a note that it could not use a real DOM because the repo had
// no DOM library and no test runner that could load one. That is no longer true -- the suite
// runs on vitest + happy-dom -- and test/steam-page-markup.test.ts now exercises the live
// adapter against real markup.
//
// The fixture is kept anyway, and is worth more now than it was then. It states the shape as
// data, so the two adapters check each other: if Steam's markup changes such that the live
// lookup produces different anchored/all inputs, the markup test fails while this one still
// passes, and the disagreement is the signal. A single adapter cannot produce that signal.
//
// A page with a pending-confirmations block ahead of the sell listings -- the PR #334 shape
// -- is:
//   { sections: [
//       { id: 'header-confirmations', hasSellListingsTable: false },
//       { id: 'header-sell-listings', hasSellListingsTable: true },
//   ] }

/** One `.market_home_listing_table` section, in DOM order. */
export interface FixtureSection {
    /** The id of this section's `.my_market_header`. */
    id: string;
    /** Whether this section holds the rows container Steam anchors the sell listings by. */
    hasSellListingsTable: boolean;
}

/** One `.itemHolder > .item` in the inventory grid. */
export interface FixtureItemHolder {
    assetId: string;
    selected: boolean;
    /** Steam's display:none while searching. */
    hidden: boolean;
}

/**
 * The '#iteminfo{view}' panel quick-sell buttons render into, and where within it they
 * attach. `ownerActionsId` stands in for the container two parents above the market listing
 * anchor -- what real markup finds by walking baseLink.parent().parent() -- so a fixture can
 * state "the buttons belong here" without needing a real DOM tree to walk.
 */
export interface FixtureItemInfoPanel {
    /** Whether '#iteminfo{view}' exists at all -- absent while Steam is still rendering it. */
    exists: boolean;
    /** Gifts render '#iteminfo{view}' with no market information at all. */
    isGift?: boolean;
    /** The id of the container the quick-sell buttons attach to, present only once the
     *  market listing anchor itself has rendered. */
    ownerActionsId?: string;
}

export interface SteamPageFixture {
    sections: FixtureSection[];
    itemHolders?: FixtureItemHolder[];
    itemInfo?: FixtureItemInfoPanel;
}

/** The pieces of the steamPage adapter a fixture can meaningfully stand in for. */
export interface FixtureSteamPage {
    sellListingsHeader(): string | undefined;
    selectedAssetIds(): string[];
    visibleItemHolderSelector(): string;
    itemInfoPanel(): FixtureItemInfoPanel | undefined;
    itemOwnerActions(
        panel: FixtureItemInfoPanel | undefined,
        marketLink: string,
    ): string | undefined;
}

export function createFixtureSteamPage(
    fixture: SteamPageFixture,
    {
        pickSellListingsHeader,
        visibleItemHolderSelector = ':not([style*=none])',
    }: {
        pickSellListingsHeader: (anchored: string[], all: string[]) => string | undefined;
        visibleItemHolderSelector?: string;
    },
): FixtureSteamPage {
    const sellListingsSection = fixture.sections.find((section) => section.hasSellListingsTable);
    const anchored = sellListingsSection ? [sellListingsSection.id] : [];
    const all = fixture.sections.map((section) => section.id);

    return {
        sellListingsHeader: () => pickSellListingsHeader(anchored, all),
        selectedAssetIds: () =>
            (fixture.itemHolders ?? [])
                .filter((holder) => holder.selected && !holder.hidden)
                .map((holder) => holder.assetId),
        visibleItemHolderSelector: () => visibleItemHolderSelector,
        itemInfoPanel: () => fixture.itemInfo,
        // marketLink is part of the real adapter's signature -- it is what the live lookup
        // re-finds the anchor by -- but the fixture already states the outcome directly.
        itemOwnerActions: (panel, _marketLink) => panel?.ownerActionsId,
    };
}
