// Removing listings from the market.
//
// Used both on its own -- the user selecting listings and removing them -- and as the first
// half of a relist, where a listing has to come down before it can go back up at a new price.

import {
    COLOR_ERROR,
    COLOR_SUCCESS,
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
} from '../constants.ts';
import { QueueTask } from '../queue/index.ts';
import { market } from '../steam/market.ts';
import { getRandomInt } from '../util/numbers.ts';
import { increaseMarketProgress } from './progress.ts';
import { getListingFromLists, marketLists, removeListingFromLists } from './sort.ts';
import $ from 'jquery';
import async from 'async';
export const marketRemoveQueue = async.queue((listingid: QueueTask, next) => {
    marketRemoveQueueWorker(listingid, false, (success) => {
        const callback = () => {
            increaseMarketProgress();
            next();
        };

        if (success) {
            setTimeout(callback, getRandomInt(50, 100));
        } else {
            setTimeout(
                () => marketRemoveQueueWorker(listingid, true, callback),
                getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
        }
    });
}, 1);

export function marketRemoveQueueWorker(listingid, ignoreErrors, callback) {
    const listingUI = getListingFromLists(listingid).elm;
    const isBuyOrder = listingUI.id.startsWith('mybuyorder_');

    market.removeListing(listingid, isBuyOrder, (errorRemove) => {
        if (!errorRemove) {
            $('.actual_content', listingUI).css('background', COLOR_SUCCESS);

            setTimeout(() => {
                removeListingFromLists(listingid);

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
