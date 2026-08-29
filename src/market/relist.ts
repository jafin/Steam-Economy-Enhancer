// Relisting overpriced items.
//
// An item listed above the going rate will not sell, so the script removes the listing and
// lists it again at a price that will. The queued set exists because a listing must not be
// relisted twice in one run.

import {
    COLOR_ERROR,
    COLOR_PENDING,
    COLOR_SUCCESS,
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
    RETRY_DELAY_SHORT_MAX,
    RETRY_DELAY_SHORT_MIN,
    VERDICT_OVERPRICED,
} from '../constants.ts';
import { QueueTask } from '../queue/index.ts';
import { steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
import { logConsole } from '../ui/logger.ts';
import { getRandomInt } from '../util/numbers.ts';
import { getAssetInfoFromListingId } from './assets.ts';
import { marketListingsRelistedAssets } from './listings.ts';
import { listingState } from './listingState.ts';
import { increaseMarketProgress, increaseMarketProgressMax, marketProgress } from './progress.ts';
import { getListFromContainer, getListingFromLists, removeListingFromLists } from './sort.ts';
import $ from 'jquery';
import async from 'async';
// Listings already queued for relisting. Relisting one twice is pointless work: the
// second attempt looks up a listing that the first one already removed. This replaces
// disabling the buttons for the duration of the run, which also blocked relisting a
// hand-picked selection while automatic relisting was working through another one.
export const marketRelistQueuedListings = new Set();

// Refreshing the buttons walks every listing of every list, so calling it once per
// listing makes a pass over N listings cost N squared. Listings answered from the cache
// are processed with no delay between them, which turns a full page of them into one
// burst, so coalesce whatever arrives before the next frame into a single refresh.
export let marketOverpricedButtonsQueued = false;

export function refreshMarketOverpricedButtons() {
    if (marketOverpricedButtonsQueued) {
        return;
    }

    marketOverpricedButtonsQueued = true;

    const refresh = () => {
        marketOverpricedButtonsQueued = false;
        updateMarketOverpricedButtons();
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(refresh);
    } else {
        setTimeout(refresh, 0);
    }
}

export const marketOverpricedQueue = async.queue((item: QueueTask, next) => {
    marketOverpricedQueueWorker(item, false, (success) => {
        const callback = () => {
            marketProgress.relistDone += 1;

            increaseMarketProgress();
            next();
        };

        if (success) {
            setTimeout(callback, getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));
        } else {
            setTimeout(
                () => marketOverpricedQueueWorker(item, true, callback),
                getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
        }
    });
}, 1);

export function marketOverpricedQueueWorker(item, ignoreErrors, callback) {
    let listingUI = getListingFromLists(item.listing);
    if (listingUI == null) {
        logConsole(`Listing ${item.listing} not found in the lists, skipping.`);

        callback(true);

        return;
    }

    listingUI = listingUI.elm;

    market.removeListing(item.listing, false, (errorRemove) => {
        if (!errorRemove) {
            $('.actual_content', listingUI).css('background', COLOR_PENDING);

            setTimeout(
                () => {
                    const itemName = $('.market_listing_item_name_link', listingUI)
                        .first()
                        .attr('href');
                    const marketHashNameIndex = itemName.lastIndexOf('/') + 1;
                    const marketHashName = itemName.substring(marketHashNameIndex);
                    const decodedMarketHashName = decodeURIComponent(
                        itemName.substring(marketHashNameIndex),
                    );
                    let newAssetId = -1;

                    steamPage.requestFullInventory(
                        `${market.inventoryUrl + item.appid}/${item.contextid}/`,
                        (transport) => {
                            if (transport.responseJSON && transport.responseJSON.success) {
                                const inventory = transport.responseJSON.rgInventory;

                                for (const child in inventory) {
                                    if (
                                        marketListingsRelistedAssets.indexOf(child) == -1 &&
                                        inventory[child].appid == item.appid &&
                                        (inventory[child].market_hash_name ==
                                            decodedMarketHashName ||
                                            inventory[child].market_hash_name == marketHashName)
                                    ) {
                                        newAssetId = child;
                                        break;
                                    }
                                }

                                if (newAssetId == -1) {
                                    $('.actual_content', listingUI).css('background', COLOR_ERROR);
                                    return callback(false);
                                }

                                item.assetid = newAssetId;
                                marketListingsRelistedAssets.push(newAssetId);

                                market.sellItem(item, item.sellPrice, (errorSell) => {
                                    if (!errorSell) {
                                        $('.actual_content', listingUI).css(
                                            'background',
                                            COLOR_SUCCESS,
                                        );

                                        setTimeout(() => {
                                            removeListingFromLists(item.listing);
                                        }, 3000);

                                        return callback(true);
                                    } else {
                                        $('.actual_content', listingUI).css(
                                            'background',
                                            COLOR_ERROR,
                                        );
                                        return callback(false);
                                    }
                                });
                            } else {
                                $('.actual_content', listingUI).css('background', COLOR_ERROR);
                                return callback(false);
                            }
                        },
                    );
                },
                getRandomInt(1500, 2500),
            ); // Wait a little to make sure the item is returned to inventory.
        } else {
            $('.actual_content', listingUI).css('background', COLOR_ERROR);
            return callback(false);
        }
    });
}

// Queue an overpriced item listing to be relisted.
// A listing is only queued once, however it was picked: automatic relisting, relist
// overpriced and relist selected all end up here and can well name the same listing.
export function queueOverpricedItemListing(listingid) {
    if (marketRelistQueuedListings.has(listingid)) {
        return;
    }

    const assetInfo = getAssetInfoFromListingId(listingid);

    // A listing with no state has not been priced yet, so there is nothing to relist at.
    const state = listingState.get(listingid);
    const price = state == null ? -1 : state.sellPrice;

    if (price > 0) {
        marketOverpricedQueue.push({
            listing: listingid,
            assetid: assetInfo.assetid,
            contextid: assetInfo.contextid,
            appid: assetInfo.appid,
            sellPrice: price,
        });

        marketRelistQueuedListings.add(listingid);
        marketProgress.relistTotal += 1;

        increaseMarketProgressMax();
        refreshMarketOverpricedButtons();
    }
}

// Shows the number of overpriced listings on the overpriced buttons.
// The count is taken from the matching items so it reflects exactly what the buttons act on,
// which means it follows the search filter.
//
// While a relist run is in progress the relist overpriced button shows the progress of the
// shared relist queue instead of the count, and is marked busy because everything it would
// queue is already queued. Relist selected is left alone: it acts on a hand-picked
// selection, which is not what a run started somewhere else is working through.
export function updateMarketOverpricedButtons() {
    const isRelisting = marketProgress.relistTotal > 0;

    $('.market_listing_buttons').each(function () {
        const selectionGroup = $(this).parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        const count = marketList.matchingItems.filter((item) =>
            $(item.elm).hasClass(VERDICT_OVERPRICED),
        ).length;

        $('.relist_overpriced > span', selectionGroup).text(
            isRelisting
                ? `Relisting ${marketProgress.relistDone}/${marketProgress.relistTotal}`
                : `Relist overpriced (${count})`,
        );

        $('.relist_overpriced', selectionGroup).toggleClass('see_button_busy', isRelisting);

        $('.select_overpriced > span', selectionGroup).text(`Select overpriced (${count})`);
    });
}
