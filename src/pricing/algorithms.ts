// Working out what to list an item for.
//
// Four algorithms, chosen by setting: the lowest listing, the buy order, an average of the
// price history, or the greater of history and listing. Each takes its inputs through a
// PricingRules value rather than reading settings, the wallet and the clock itself, which
// is what makes the numbers a user's items sell for testable.

import { getIsFoilTradingCard, getIsTradingCard } from '../items/index.ts';
import {
    getSetting,
    SETTING_MAX_FOIL_PRICE,
    SETTING_MAX_MISC_PRICE,
    SETTING_MAX_NORMAL_PRICE,
    SETTING_MIN_FOIL_PRICE,
    SETTING_MIN_MISC_PRICE,
    SETTING_MIN_NORMAL_PRICE,
    SETTING_PRICE_ALGORITHM,
    SETTING_PRICE_HISTORY_HOURS,
    SETTING_PRICE_IGNORE_LOWEST_Q,
    SETTING_PRICE_OFFSET,
} from '../settings/index.ts';
import { currencyCode, currencyCountry, useRound } from '../steam/currency.ts';
import { isLoggedIn, steamPage } from '../steam/instance.ts';
import { clamp, priceBeforeFees } from './fees.ts';
import type { PricingRules } from './rules.ts';

// Calculates the average history price, before the fee.
// The four pricing algorithms offered by the settings dialog. Lowest listing is the
// fallback the calculation lands on when none of the other three are selected, so it is
// named here for completeness rather than tested for.
export const ALGORITHM_MAX_OF_HISTORY_AND_LISTING = 1;

export const ALGORITHM_LOWEST_LISTING = 2;

export const ALGORITHM_HIGHEST_BUY_ORDER = 3;

export const ALGORITHM_AVERAGE_HISTORY = 4;

//#region Price helpers
export function formatPrice(valueInCents) {
    return steamPage.formatPrice(valueInCents, currencyCode, currencyCountry);
}

// Renders a price delta in cents as `+€0.42`.
//
// The sign is applied here rather than passed down to `formatPrice`, which delegates to
// Steam's own currency formatter: what that does with a negative is locale-dependent and
// undocumented, and one of the possibilities is accounting-style parentheses. Formatting
// the absolute value and prefixing the sign ourselves gives one predictable rendering in
// every locale.
//
// A zero delta renders as nothing at all. That is what keeps the fair verdict from needing
// a branch at the call site.
//
// This lives beside `formatPrice` rather than beside `getListingPriceDelta`, which
// computes the value: `items/index.ts` imports from `market/listingState.ts` and this
// module imports from `items/index.ts`, so a formatter there that needed `formatPrice`
// would close the cycle listingState -> algorithms -> items -> listingState.
export function formatPriceDelta(cents) {
    if (!cents) {
        return '';
    }

    return `${cents > 0 ? '+' : '−'}${formatPrice(Math.abs(cents))}`;
}

// The wallet, read through the page adapter rather than the `market` singleton. They are
// the same object -- market is constructed with exactly this value, the same reasoning
// currency.ts already uses -- and going direct is what lets pricing/ drop its last
// dependency on SteamMarket.
function walletRules(): PricingRules {
    return { walletInfo: isLoggedIn ? steamPage.walletInfo() : undefined, useRound };
}

function getPriceInformationFromItem(item) {
    const isTradingCard = getIsTradingCard(item);
    const isFoilTradingCard = getIsFoilTradingCard(item);
    return getPriceInformation(isTradingCard, isFoilTradingCard);
}

function getPriceInformation(isTradingCard, isFoilTradingCard) {
    let maxPrice: number;
    let minPrice: number;

    if (!isTradingCard) {
        maxPrice = getSetting(SETTING_MAX_MISC_PRICE);
        minPrice = getSetting(SETTING_MIN_MISC_PRICE);
    } else {
        maxPrice = isFoilTradingCard
            ? getSetting(SETTING_MAX_FOIL_PRICE)
            : getSetting(SETTING_MAX_NORMAL_PRICE);
        minPrice = isFoilTradingCard
            ? getSetting(SETTING_MIN_FOIL_PRICE)
            : getSetting(SETTING_MIN_NORMAL_PRICE);
    }

    maxPrice = maxPrice * 100.0;
    minPrice = minPrice * 100.0;

    const rules = walletRules();

    const maxPriceBeforeFees = priceBeforeFees(maxPrice, null, rules);
    const minPriceBeforeFees = priceBeforeFees(minPrice, null, rules);

    return {
        maxPrice,
        minPrice,
        maxPriceBeforeFees,
        minPriceBeforeFees,
    };
}

// Passed as the max to calculateSellPriceBeforeFees when there is nobody to undercut and
// no minimum/maximum should clamp the result: an unreachably high ceiling that reads back
// as "unpriced" rather than a real price. Nobody is selling this item, so there is nothing
// to show and nothing to add to a trade offer total.
export const NO_LISTING_PRICE_SENTINEL = 65535;

export function createPricingRules(item?): PricingRules {
    const rules: PricingRules = {
        algorithm: getSetting(SETTING_PRICE_ALGORITHM),
        offsetCents: getSetting(SETTING_PRICE_OFFSET) * 100,
        historyHours: getSetting(SETTING_PRICE_HISTORY_HOURS),
        ignoreLowestOnLowQuantity: getSetting(SETTING_PRICE_IGNORE_LOWEST_Q) == 1,
        ...walletRules(),
        now: Date.now(),
    };

    // No item means no card class to look the bounds up against. They fall back to the
    // non-card (misc) branch getPriceInformation takes for isTradingCard = false, same as
    // passing an item that isn't a trading card. Nothing relies on this default today: every
    // per-item caller passes its item, and inventoryPriceQueueWorker -- the one caller that
    // omits it -- overrides both bounds explicitly for the "nobody is selling this" sentinel
    // case (NO_LISTING_PRICE_SENTINEL) rather than reading them from here.
    const priceInfo =
        item != null ? getPriceInformationFromItem(item) : getPriceInformation(false, false);

    rules.minPriceBeforeFees = priceInfo.minPriceBeforeFees;
    rules.maxPriceBeforeFees = priceInfo.maxPriceBeforeFees;

    return rules;
}

export function calculateAverageHistoryPriceBeforeFees(
    history,
    rules: PricingRules = createPricingRules(),
) {
    let highest = 0;
    let total = 0;

    if (history != null) {
        // Highest average price in the last xx hours.
        const timeAgo = rules.now! - rules.historyHours! * 60 * 60 * 1000;

        history.forEach((historyItem) => {
            const d = new Date(historyItem[0]);
            if (d.getTime() > timeAgo) {
                highest += historyItem[1] * historyItem[2];
                total += historyItem[2];
            }
        });
    }

    if (total == 0) {
        return 0;
    }

    highest = Math.floor(highest / total);
    return priceBeforeFees(highest, null, rules);
}

// Calculates the listing price, before the fee.
export function calculateListingPriceBeforeFees(
    orderbook,
    rules: PricingRules = createPricingRules(),
) {
    if (
        typeof orderbook === 'undefined' ||
        orderbook == null ||
        orderbook.lowest_sell_order == null ||
        orderbook.sell_order_graph == null
    ) {
        return 0;
    }

    let listingPrice = priceBeforeFees(orderbook.lowest_sell_order, null, rules);

    if (rules.ignoreLowestOnLowQuantity && orderbook.sell_order_graph.length >= 2) {
        const listingPrice2ndLowest = priceBeforeFees(
            orderbook.sell_order_graph[1][0] * 100,
            null,
            rules,
        );

        if (listingPrice2ndLowest > listingPrice) {
            const numberOfListingsLowest = orderbook.sell_order_graph[0][1];
            const numberOfListings2ndLowest = orderbook.sell_order_graph[1][1];

            const percentageLower = 100 * (numberOfListingsLowest / numberOfListings2ndLowest);

            // The percentage should change based on the quantity (for example, 1200 listings vs 5, or 1 vs 25).
            if (numberOfListings2ndLowest >= 1000 && percentageLower <= 5) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 1000 && percentageLower <= 10) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 100 && percentageLower <= 15) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 50 && percentageLower <= 20) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 25 && percentageLower <= 25) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 10 && percentageLower <= 30) {
                listingPrice = listingPrice2ndLowest;
            }
        }
    }

    return listingPrice;
}

export function calculateBuyOrderPriceBeforeFees(
    orderbook,
    rules: PricingRules = createPricingRules(),
) {
    // buildOrderBook returns null for an unsuccessful response, so null reaches here as
    // readily as undefined. calculateListingPriceBeforeFees has always guarded both.
    if (typeof orderbook === 'undefined' || orderbook == null) {
        return 0;
    }

    return priceBeforeFees(orderbook.highest_buy_order, null, rules);
}

// Calculate the sell price based on the history and listings.
// applyOffset specifies whether the price offset should be applied when the listings are used to determine the price.
export function calculateSellPriceBeforeFees(
    history,
    orderbook,
    applyOffset,
    rules: PricingRules = createPricingRules(),
) {
    const minPriceBeforeFees = rules.minPriceBeforeFees!;
    const maxPriceBeforeFees = rules.maxPriceBeforeFees!;

    const historyPrice = calculateAverageHistoryPriceBeforeFees(history, rules);
    const listingPrice = calculateListingPriceBeforeFees(orderbook, rules);
    const buyPrice = calculateBuyOrderPriceBeforeFees(orderbook, rules);

    const shouldUseAverage = rules.algorithm === ALGORITHM_MAX_OF_HISTORY_AND_LISTING;
    const shouldUseBuyOrder = rules.algorithm === ALGORITHM_HIGHEST_BUY_ORDER;
    const shouldUseHistory = rules.algorithm === ALGORITHM_AVERAGE_HISTORY;

    // If the highest average price is lower than the first listing, return the offset + that listing.
    // Otherwise, use the highest average price instead.
    let calculatedPrice: number;
    if (shouldUseBuyOrder) {
        calculatedPrice = buyPrice;
    } else if ((historyPrice < listingPrice || !shouldUseAverage) && !shouldUseHistory) {
        calculatedPrice = listingPrice;
    } else {
        calculatedPrice = historyPrice;
    }

    let changedToMax = false;
    // List for the maximum price if there are no listings yet.
    if (calculatedPrice == 0) {
        calculatedPrice = maxPriceBeforeFees;
        changedToMax = true;
    }

    // Apply the offset to the calculated price, but only if the price wasn't changed to the max (as otherwise it's impossible to list for this price).
    if (!changedToMax && applyOffset) {
        calculatedPrice = calculatedPrice + rules.offsetCents!;
    }

    // Keep our minimum and maximum in mind.
    calculatedPrice = clamp(calculatedPrice, minPriceBeforeFees, maxPriceBeforeFees);

    // In case there's a buy order higher than the calculated price.
    if (
        !shouldUseHistory &&
        typeof orderbook !== 'undefined' &&
        orderbook != null &&
        orderbook.highest_buy_order != null
    ) {
        const buyOrderPrice = priceBeforeFees(orderbook.highest_buy_order, null, rules);
        if (buyOrderPrice > calculatedPrice) {
            calculatedPrice = buyOrderPrice;
        }
    }

    return calculatedPrice;
}
