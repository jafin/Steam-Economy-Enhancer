// Removing listings from the market.
//
// Used both on its own -- the user selecting listings and removing them -- and as the first
// half of a relist, where a listing has to come down before it can go back up at a new price.

import { COLOR_ERROR, COLOR_SUCCESS } from '../constants.ts';
import { runQueue } from '../queue/index.ts';
import { market } from '../steam/market.ts';
import { logConsole } from '../ui/logger.ts';
import { getRandomInt } from '../util/numbers.ts';
import { workDone } from './progress.ts';
import { refreshMarketOverpricedButtons } from './relist.ts';
import { getListingFromLists, marketLists, removeListingFromLists } from './rows.ts';
import $ from 'jquery';
export const marketRemoveQueue = runQueue(marketRemoveQueueWorker, {
    retryOnFailure: true,
    retryPlacement: 'front',
    successDelayMs: () => getRandomInt(50, 100),
    onTaskDone: () => workDone(),
});

// The task carries the listing id rather than being it. runQueue marks a task for its one
// forced retry by setting a property on it, and a bare string cannot carry one -- assigning
// to a primitive throws in a module, which is always strict.
export function marketRemoveQueueWorker(task, ignoreErrors, callback) {
    const listingid = task.listingid;
    const listing = getListingFromLists(listingid);
    if (listing == null) {
        logConsole(`Listing ${listingid} not found in the lists, skipping.`);

        callback(true);

        return;
    }

    const listingUI = listing.elm;
    const isBuyOrder = listingUI.id.startsWith('mybuyorder_');

    market.removeListing(listingid, isBuyOrder, (errorRemove) => {
        if (!errorRemove) {
            $('.actual_content', listingUI).css('background', COLOR_SUCCESS);

            setTimeout(() => {
                removeListingFromLists(listingid);

                // Listings are removed from the lists a few seconds after they are relisted
                // or removed, which can be after the queue drained, so refresh the counts
                // here as well.
                refreshMarketOverpricedButtons();

                const numberOfListings = marketLists[0].size;
                if (numberOfListings > 0) {
                    $('#my_market_selllistings_number').text(numberOfListings.toString());

                    // This seems identical to the number of sell listings.
                    $('#my_market_activelistings_number').text(numberOfListings.toString());
                }
            }, 3000);

            return callback(true);
        } else {
            $('.actual_content', listingUI).css('background', COLOR_ERROR);

            return callback(false);
        }
    });
}
