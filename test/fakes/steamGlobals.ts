// Steam's page globals.
//
// The wallet is a real-looking EUR wallet so the fee maths has something to work with;
// tests that care about specific values pass their own in explicitly.

export function fakeSteamWindow(): any {
    return {
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
        g_rgAssets: {},
        GetCurrencyCode: () => 'EUR',
        GetPriceValueAsInt: (s: string) =>
            Math.round(parseFloat(String(s).replace(',', '.')) * 100) || 0,
        v_currencyformat: (v: number) => String(v),
    };
}
