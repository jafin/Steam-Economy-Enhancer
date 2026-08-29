// The Steam page adapter.
//
// Everything Steam's own page exposes, behind one seam. Before this existed, unsafeWindow
// reach-ins happened at roughly 44 sites across the whole file, which is what allowed the
// bug fixed in PR #334: Steam changed which DOM element the sell listings' header was, and
// a naive lookup silently grabbed the wrong one. Nothing threw; the Relist and Select
// buttons just stopped appearing.
//
// createSteamPage(win) is the live adapter. test/steam-page-fixture.ts is a second one
// built from data, and test/steam-page-markup.test.ts runs this one against real markup --
// so the shape this script expects Steam's page to have is pinned by tests from both
// sides.

import $ from 'jquery';

// The rule PR #334 needed, pulled out of the DOM lookup that feeds it: prefer the header
// anchored to the sell listings table itself, and only fall back to "whichever header
// is first" when the anchored lookup truly finds nothing. `anchored`/`all` need only
// `.length` and index access, so this runs the same whether they came from a real
// jQuery selection or plain fixture data - see test/steam-page-fixture.js.
export function pickSellListingsHeader(anchored, all) {
    return anchored.length > 0 ? anchored[0] : all[0];
}

// `win` is Steam's own window and is deliberately untyped: this is the boundary described
// in src/steam/globals.d.ts, and it is the only place `any` is allowed in. Everything
// downstream of the returned adapter is typed normally.
export function createSteamPage(win: any) {
    return {
        // Session / config
        isLoggedIn: () =>
            (typeof win.g_rgWalletInfo !== 'undefined' && win.g_rgWalletInfo != null) ||
            (typeof win.g_bLoggedIn !== 'undefined' && win.g_bLoggedIn),
        countryCode: () =>
            typeof win.g_strCountryCode !== 'undefined' ? win.g_strCountryCode : undefined,
        walletInfo: () => win.g_rgWalletInfo,
        appContextData: () => win.g_rgAppContextData,
        inventoryLoadUrl: () => win.g_strInventoryLoadURL || undefined,
        profileUrl: () => win.g_strProfileURL || undefined,
        currencyCode: (currencyId) => win.GetCurrencyCode(currencyId),
        formatPrice: (valueInCents, currencyCode, currencyCountry) =>
            win.v_currencyformat(valueInCents, currencyCode, currencyCountry),
        parsePriceText: (text) => win.GetPriceValueAsInt(text),
        showDialog: (title, html) => win.ShowDialog(title, html),
        showConfirmDialog: (title, html) => win.ShowConfirmDialog(title, html),

        // Inventory
        activeInventory: () => win.g_ActiveInventory,
        activeUser: () => win.g_ActiveUser,
        steamId: () => win.g_steamID,
        activeSelectView: () => win.iActiveSelectView,

        // Patches CInventory.prototype.SelectItem to also call handler(rgItem) after
        // Steam's own selection handling, and returns a teardown that restores the
        // original. A no-op, reversible teardown if CInventory never loaded.
        onInventorySelectItem(handler) {
            if (typeof win.CInventory === 'undefined') {
                return () => {};
            }

            const original = win.CInventory.prototype.SelectItem;

            win.CInventory.prototype.SelectItem = function (event, elItem, rgItem) {
                // Steam owns this signature, so the patch forwards precisely what Steam
                // passed rather than a list this file has guessed at.
                // eslint-disable-next-line prefer-rest-params
                original.apply(this, arguments);
                handler(rgItem);
            };

            return () => {
                win.CInventory.prototype.SelectItem = original;
            };
        },

        // Market assets
        assetFor: (appid, contextid, assetid) => win.g_rgAssets?.[appid]?.[contextid]?.[assetid],
        setAsset: (appid, contextid, assetid, asset) => {
            win.g_rgAssets[appid][contextid][assetid] = asset;
        },

        // There is only one item in g_rgAssets on a market listing page - the first (and
        // only) leaf this finds, whatever its appid/contextid/assetid.
        firstAsset: () => {
            for (const appid in win.g_rgAssets) {
                for (const contextid in win.g_rgAssets[appid]) {
                    for (const assetid in win.g_rgAssets[appid][contextid]) {
                        return win.g_rgAssets[appid][contextid][assetid];
                    }
                }
            }

            return null;
        },

        mergeAssets: (assets) => win.MergeWithAssetArray(assets),
        requestFullInventory: (url, callback) =>
            win.RequestFullInventory(url, {}, null, null, callback),
        myListingsTotalCount: () =>
            typeof win.g_oMyListings !== 'undefined' && win.g_oMyListings != null
                ? win.g_oMyListings.m_cTotalCount
                : null,
        goToHistoryPage: (index) => {
            if (typeof win.g_oMyHistory !== 'undefined') {
                win.g_oMyHistory.GoToPage(index);
            }
        },

        // The header the sell listings buttons attach to. See pickSellListingsHeader.
        sellListingsHeader: () => {
            const anchored = $('#tabContentsMyActiveMarketListingsRows')
                .closest('.market_home_listing_table')
                .find('.my_market_header');
            const all = $('.my_market_header');

            return $(pickSellListingsHeader(anchored, all));
        },

        // Trade offer. `side` is 'me' or 'them', the same keys g_rgCurrentTradeStatus
        // itself uses, so both sides of a trade can be walked with one loop over
        // ['me', 'them'] instead of the same code written out twice.
        tradeAssets: (side) => win.g_rgCurrentTradeStatus[side].assets,
        findTradeAsset: (side, appid, contextid, assetid) => {
            const user = side === 'me' ? win.UserYou : win.UserThem;

            return user.findAsset(appid, contextid, assetid);
        },
        moveItemToTrade: (item) => win.MoveItemToTrade(item),
    };
}
