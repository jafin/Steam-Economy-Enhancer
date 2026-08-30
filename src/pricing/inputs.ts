// Fetching the price history and order book for one item.
//
// itemQueueWorker (inventory/sell.ts), inventoryPriceQueueWorker (inventory/data.ts) and
// marketListingsQueueWorker (market/listings.ts) each repeated the same preamble before
// they could call calculateSellPriceBeforeFees: ask Steam for the history and the order
// book, count the requests that reached Steam and failed, and combine both answers' cache
// flags into one. This is that preamble, in one place.

import { logConsole } from '../ui/logger.ts';
import { market } from '../steam/market.ts';

export interface PricingInputs {
    /** Steam's price history for the item, or null when opts.history is false. */
    history: any;
    orderbook: any;
    /** Requests that reached Steam and failed. A cached answer counts as neither. */
    failed: number;
    /** Whether every answer used here came from the cache rather than a live request. */
    cached: boolean;
}

/**
 * The price history and order book for one item.
 * `failed` counts requests that reached Steam and failed; a cached answer counts as neither.
 */
export function fetchPricingInputs(
    item,
    opts: { history: boolean; name: string },
    callback: (inputs: PricingInputs) => void,
): void {
    let failed = 0;

    const withOrderBook = (history, cachedHistory) => {
        market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
            if (err) {
                logConsole(`Failed to get order book for ${opts.name}`);
                failed += 1;
            }

            callback({ history, orderbook, failed, cached: cachedHistory && cachedListings });
        });
    };

    if (!opts.history) {
        // data.ts asks for the order book only, so there is only one cache flag to report.
        // Feeding `true` through here as cachedHistory does that harmlessly: `true &&
        // cachedListings` is just `cachedListings`, same as the ANDed rule with history
        // fetched, but without ANDing against an undefined "not asked for" flag.
        withOrderBook(null, true);
        return;
    }

    market.getPriceHistory(item, true, (err, history, cachedHistory) => {
        if (err) {
            logConsole(`Failed to get price history for ${opts.name}`);
            failed += 1;
        }

        withOrderBook(history, cachedHistory);
    });
}
