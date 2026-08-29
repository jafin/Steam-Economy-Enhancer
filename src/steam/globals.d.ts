// The Steam page boundary.
//
// This is the one place `any` is allowed to enter. Steam's own page globals are untyped,
// undocumented and change without notice, so modelling them precisely would be false
// confidence. What matters is that the reach-ins are contained: the architecture refactor
// already funnelled all ~44 of them through createSteamPage(win), which touches
// `unsafeWindow` exactly once. Everything downstream of that adapter is typed normally.

/** Steam's wallet descriptor. The fee maths depends on every one of these. */
export interface WalletInfo {
    wallet_currency: number;
    wallet_country: string;
    wallet_fee_base: number | string;
    wallet_fee_percent: number | string;
    wallet_fee_minimum: number | string;
    wallet_publisher_fee_percent_default: number | string;
    wallet_max_balance?: number;
    wallet_trade_max_balance?: number;
}

/** Steam's page globals, as reached through `unsafeWindow`. Deliberately loose. */
export interface SteamWindow {
    // Session / config
    g_rgWalletInfo?: WalletInfo;
    g_bLoggedIn?: boolean;
    g_strCountryCode?: string;
    g_rgAppContextData?: Record<string, unknown>;
    g_strInventoryLoadURL?: string;
    g_strProfileURL?: string;
    GetCurrencyCode(currencyId: number): string;
    v_currencyformat(valueInCents: number, currencyCode: string, currencyCountry?: string): string;
    GetPriceValueAsInt(text: string): number;
    ShowDialog(title: string, html: string): unknown;
    ShowConfirmDialog(title: string, html: string): unknown;

    // Inventory
    g_ActiveInventory?: any;
    g_ActiveUser?: any;
    g_steamID?: string;
    iActiveSelectView?: number;
    CInventory?: { prototype: { SelectItem: (...args: any[]) => void } };

    // Market
    g_rgAssets?: Record<string, Record<string, Record<string, any>>>;
    MergeWithAssetArray(assets: unknown): unknown;
    RequestFullInventory(
        url: string,
        params: object,
        a: null,
        b: null,
        callback: (...args: any[]) => void,
    ): void;
    g_oMyListings?: { m_cTotalCount: number };
    g_oMyHistory?: { GoToPage(index: number): void };

    // Trade offer
    g_rgCurrentTradeStatus: Record<'me' | 'them', { assets: any[] }>;
    UserYou: { findAsset(appid: string, contextid: string, assetid: string): any };
    UserThem: { findAsset(appid: string, contextid: string, assetid: string): any };
    MoveItemToTrade(item: unknown): void;
}

declare global {
    /** Granted by `@grant unsafeWindow`. The page's real window, not the sandbox's. */
    const unsafeWindow: SteamWindow;
}
