// The user's currency, and how its fees round.
//
// Read from the wallet rather than from settings: Steam decides this, not the user.

import { isLoggedIn, steamPage } from './instance.ts';

// Reads the wallet through the page adapter rather than through the `market` singleton.
// They are the same object -- market is constructed with exactly this value -- and going
// direct is what keeps this module below SteamMarket in the import graph rather than beside
// it, which is what stops the two forming a cycle. The `market != null` guard the original
// carried was vacuous: it tested a value that had just been constructed.
const walletInfo = isLoggedIn ? steamPage.walletInfo() : undefined;

export const currencyId =
    isLoggedIn && walletInfo != null && walletInfo.wallet_currency != null
        ? walletInfo.wallet_currency
        : 3;

export const currencyCountry =
    isLoggedIn && walletInfo != null && walletInfo.wallet_country != null
        ? walletInfo.wallet_country
        : 'US';

export const currencyCode = steamPage.currencyCode(currencyId);

// Currencies affected by the December 2025 Steam Market rule changes.
// These currencies use round instead of floor.
// Reference: https://steamcommunity.com/groups/community_market/discussions/0/682988196226679356
// Alternative approach: Check currency code instead of ID for better reliability
export const CURRENCY_CODES_TO_ROUND = [
    'JPY', // Japanese Yen (unit: 1)
    'IDR', // Indonesian Rupiah (unit: 1)
    'UAH', // Ukrainian Hryvnia (unit: 1)
    'CLP', // Chilean Peso (unit: 1)
    'COP', // Colombian Peso (unit: 1)
    'TWD', // New Taiwan Dollar (unit: 1)
    'KZT', // Kazakhstani Tenge (unit: 1)
    'CRC', // Costa Rican Colón (unit: 5)
    'UYU', // Uruguayan Peso (unit: 1)
    'KRW', // South Korean Won (unit: 10)
    'VND', // Vietnamese Dong (unit: 500)
];

// Check if the current currency uses round for fees.
export const useRound = CURRENCY_CODES_TO_ROUND.includes(currencyCode);
