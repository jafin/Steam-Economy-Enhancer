// Steam's page globals.
//
// The wallet is a real-looking EUR wallet so the fee maths has something to work with;
// tests that care about specific values pass their own in explicitly.
//
// This covers rather more than the pure-function tests need, because the bootstrap smoke
// tests load the script as each page it supports and run that page's initialise path. Every
// field below is one the bootstrap actually reads -- they were added by watching it fail,
// not by guessing at Steam's API.

export function fakeSteamWindow(): any {
    return {
        // Session / config
        g_strCountryCode: 'NL',
        g_bLoggedIn: true,
        g_rgWalletInfo: {
            wallet_currency: 3,
            wallet_country: 'NL',
            wallet_fee_base: 0,
            wallet_fee_percent: 0.05,
            wallet_fee_minimum: 1,
            wallet_publisher_fee_percent_default: 0.1,
            wallet_max_balance: 200000,
            wallet_trade_max_balance: 180000,
        },
        g_rgAppContextData: {},
        g_strInventoryLoadURL: 'https://steamcommunity.com/id/test/inventory/json/',
        g_strProfileURL: 'https://steamcommunity.com/id/test',

        // Inventory. The bootstrap compares the active user against the profile owner to
        // decide whether this is the user's own inventory, so both ids must be present.
        g_ActiveUser: { strSteamId: '76561190000000000' },
        g_steamID: '76561190000000000',
        g_ActiveInventory: {
            m_rgChildInventories: {},
            m_rgAssets: {},
            selectedItem: null,

            // Steam returns a jQuery Deferred here and loadAllInventories() awaits it before
            // reading any item. Resolving immediately keeps the fake inventory as loaded as
            // it will ever get -- m_rgAssets above is already the whole of it.
            LoadCompleteInventory: () => ({ done: (callback: () => void) => callback() }),
        },
        iActiveSelectView: 0,

        // Market
        g_rgAssets: {},
        g_oMyListings: { m_cTotalCount: 0 },
        MergeWithAssetArray: () => undefined,
        RequestFullInventory: () => undefined,

        // Trade offer
        g_rgCurrentTradeStatus: { me: { assets: [] }, them: { assets: [] } },
        UserYou: { findAsset: () => null },
        UserThem: { findAsset: () => null },
        MoveItemToTrade: () => undefined,

        // Formatting and dialogs
        GetCurrencyCode: () => 'EUR',
        GetPriceValueAsInt: (s: string) =>
            Math.round(parseFloat(String(s).replace(',', '.')) * 100) || 0,
        v_currencyformat: (v: number) => String(v),
        ShowDialog: () => undefined,
        ShowConfirmDialog: () => undefined,
    };
}
