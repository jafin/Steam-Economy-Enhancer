// Reading the market listings page.
//
// Two queues. marketListingsQueue prices each listing so it can be marked overpriced,
// underpriced or fair; marketListingsItemsQueue fetches the item behind each row. The page
// is paginated, so filling the queue means walking the pages Steam has loaded.

import {
    COLOR_PRICE_NOT_CHECKED,
    ERROR_SUCCESS,
    PAGE_MARKET,
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
    RETRY_DELAY_SHORT_MAX,
    RETRY_DELAY_SHORT_MIN,
    VERDICT_COLORS,
    VERDICT_MESSAGES,
    VERDICT_OVERPRICED,
} from '../constants.ts';
import { getMarketHashName } from '../items/index.ts';
import { request } from '../net/request.ts';
import {
    calculateSellPriceBeforeFees,
    createPricingRules,
    formatPrice,
    formatPriceDelta,
    getPriceInformationFromItem,
} from '../pricing/algorithms.ts';
import { QueueTask } from '../queue/index.ts';
import {
    SETTING_PRICE_MIN_CHECK_PRICE,
    SETTING_RELIST_AUTOMATICALLY,
    getSettingWithDefault,
} from '../settings/index.ts';
import { currentPage, steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
import { renderSpinner } from '../ui/index.ts';
import { logConsole } from '../ui/logger.ts';
import { getRandomInt, replaceNonNumbers } from '../util/numbers.ts';
import { getAssetInfoFromBuyOrderId, getAssetInfoFromListingId } from './assets.ts';
import { getListingPriceDelta, getListingVerdict, listingState } from './listingState.ts';
import { increaseMarketProgress, increaseMarketProgressMax } from './progress.ts';
import { queueOverpricedItemListing, refreshMarketOverpricedButtons } from './relist.ts';
import { getListingFromLists, marketLists, sortMarketListings } from './sort.ts';
import { updateMarketSelectAllButton } from './ui.ts';
import $ from 'jquery';
import async from 'async';
import List from 'list.js';
//#region Market
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_MARKET || currentPage == PAGE_MARKET_LISTING
export const marketListingsRelistedAssets: any[] = [];

// Match number part from any currency format
export const getPriceValueAsInt = (listing) =>
    steamPage.parsePriceText(listing.match(/(?<price>[0-9][0-9 .,]*)/)?.groups?.price ?? 0);

// Writes how far a listing is from its best price into the price cell, under the price.
//
// Idempotent on purpose. A row can be priced more than once -- the queue above retries a
// failed listing once with ignoreErrors set, and both attempts reach here -- so this
// selects the label and creates it only when it is missing, rather than appending. An
// append would render the delta twice on every retried row.
//
// It appends to the *end* of the cell, and that position is load-bearing twice over.
// getPriceValueAsInt reads the listed price through
// `.market_listing_price > span:nth-child(1) > span:nth-child(1)`, so anything inserted at
// the front of that cell shifts nth-child and the script reads the wrong price, giving a
// wrong verdict and a wrong relist price with nothing thrown. And the price sort in
// sort.ts truncates the cell text at the first `(` to drop Steam's seller price, so a
// label containing parentheses must come after the pair Steam already wrote. The buy order
// price further down appends into this same region for the same reasons.
//
// Called with an empty string to clear, which is how a label from an earlier pass is kept
// from surviving under a cell that has since gone grey.
function setListingPriceDeltaLabel(listingUI, text) {
    const priceCell = $('.market_listing_my_price', listingUI).last();
    let label = $('.see_price_delta', priceCell);

    if (label.length === 0) {
        if (text === '') {
            return;
        }

        label = $('<span class="see_price_delta"></span>');
        priceCell.append(label);
    }

    label.text(text);
}

export const marketListingsQueue = async.queue((listing: QueueTask, next) => {
    marketListingsQueueWorker(listing, false, (success, cached) => {
        const callback = () => {
            increaseMarketProgress();
            next();
        };

        if (success) {
            setTimeout(
                callback,
                cached ? 0 : getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX),
            );
        } else {
            setTimeout(
                () => marketListingsQueueWorker(listing, true, callback),
                cached ? 0 : getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
        }
    });
}, 1);

export function marketListingsQueueWorker(listing, ignoreErrors, callback) {
    const asset = steamPage.assetFor(listing.appid, listing.contextid, listing.assetid);

    // An asset:
    //{
    // "currency" : 0,
    // "appid" : 753,
    // "contextid" : "6",
    // "id" : "4363079664",
    // "classid" : "2228526061",
    // "instanceid" : "0",
    // "amount" : "1",
    // "status" : 2,
    // "original_amount" : "1",
    // "background_color" : "",
    // "icon_url" : "xx",
    // "icon_url_large" : "xxx",
    // "descriptions" : [{
    //   "value" : "Their dense, shaggy fur conceals the presence of swams of moogamites, purple scaly skin, and more nipples than one would expect."
    //  }
    // ],
    // "tradable" : 1,
    // "owner_actions" : [{
    //   "link" : "http://steamcommunity.com/my/gamecards/443880/",
    //   "name" : "View badge progress"
    //  }, {
    //   "link" : "javascript:GetGooValue( '%contextid%', '%assetid%', 443880, 7, 0 )",
    //   "name" : "Turn into Gems..."
    //  }
    // ],
    // "name" : "Wook",
    // "type" : "Loot Rascals Trading Card",
    // "market_name" : "Wook",
    // "market_hash_name" : "443880-Wook",
    // "market_fee_app" : 443880,
    // "commodity" : 1,
    // "market_tradable_restriction" : 7,
    // "market_marketable_restriction" : 7,
    // "marketable" : 1,
    // "app_icon" : "xxxx",
    // "owner" : 0
    //}

    const market_hash_name = getMarketHashName(asset);
    const appid = listing.appid;

    let listingUI = getListingFromLists(listing.listingid);
    if (listingUI == null) {
        logConsole(`Listing ${listing.listingid} not found in the lists, skipping.`);

        callback(true, true);

        return;
    }

    listingUI = $(listingUI.elm);

    const game_name = asset.type;
    const price = getPriceValueAsInt(
        $('.market_listing_price > span:nth-child(1) > span:nth-child(1)', listingUI).text(),
    );

    if (
        price <= getSettingWithDefault(SETTING_PRICE_MIN_CHECK_PRICE) * 100 ||
        listingUI.hasClass('removing')
    ) {
        $('.market_listing_my_price', listingUI).last().css('background', COLOR_PRICE_NOT_CHECKED);
        $('.market_listing_my_price', listingUI).last().prop('title', 'The price is not checked.');
        // This path returns without pricing, so any delta from an earlier pass is now
        // stale. Clear it rather than leave a number sitting under a grey cell.
        setListingPriceDeltaLabel(listingUI, '');
        listingUI.addClass('not_checked');

        return callback(true, true);
    }

    const priceInfo = getPriceInformationFromItem(asset);
    const item = {
        appid: parseInt(appid),
        description: {
            market_hash_name: market_hash_name,
        },
    };

    let failed = 0;

    market.getPriceHistory(item, true, (errorPriceHistory, history, cachedHistory) => {
        if (errorPriceHistory) {
            logConsole(`Failed to get price history for ${game_name}`);

            if (errorPriceHistory != ERROR_SUCCESS) {
                failed += 1;
            }
        }

        market.getOrderBook(item, true, (errorOrderBook, orderbook, cachedListings) => {
            if (errorOrderBook) {
                logConsole(`Failed to get order book for ${game_name}`);

                if (errorOrderBook != ERROR_SUCCESS) {
                    failed += 1;
                }
            }

            if (failed > 0 && !ignoreErrors) {
                return callback(false, cachedHistory && cachedListings);
            }

            // Shows the highest buy order price on the market listings.
            // The 'orderbook.highest_buy_order' is not reliable as Steam is caching this value, but it gives some idea for older titles/listings.
            const highestBuyOrderPrice =
                orderbook == null || orderbook.highest_buy_order == null
                    ? '-'
                    : formatPrice(orderbook.highest_buy_order);
            $(
                '.market_table_value > span:nth-child(1) > span:nth-child(1) > span:nth-child(1)',
                listingUI,
            ).append(
                ` ➤ <span title="This is likely the highest buy order price.">${
                    highestBuyOrderPrice
                }</span>`,
            );

            logConsole('============================');
            logConsole(JSON.stringify(listing));
            logConsole(`${game_name}: ${asset.name}`);
            logConsole(`Current price: ${price / 100.0}`);

            // Calculate two prices here, one without the offset and one with the offset.
            // The price without the offset is required to not relist the item constantly when you have the lowest price (i.e., with a negative offset).
            // The price with the offset should be used for relisting so it will still apply the user-set offset.
            //
            // Built once and passed to both calls: two independent
            // createPricingRules() calls could in principle read the settings
            // or the wall clock a moment apart and disagree on this one item.
            const rules = createPricingRules();

            const sellPriceWithoutOffset = calculateSellPriceBeforeFees(
                history,
                orderbook,
                false,
                priceInfo.minPriceBeforeFees,
                priceInfo.maxPriceBeforeFees,
                rules,
            );
            const sellPriceWithOffset = calculateSellPriceBeforeFees(
                history,
                orderbook,
                true,
                priceInfo.minPriceBeforeFees,
                priceInfo.maxPriceBeforeFees,
                rules,
            );

            const sellPriceWithoutOffsetWithFees =
                market.getPriceIncludingFees(sellPriceWithoutOffset);

            logConsole(
                `Calculated price: ${sellPriceWithoutOffsetWithFees / 100.0} (${sellPriceWithoutOffset / 100.0})`,
            );

            const verdict = getListingVerdict(sellPriceWithoutOffsetWithFees, price);

            // Same two numbers the verdict is computed from, so the delta and the colour
            // can never disagree about which side of the best price this listing is on.
            const priceDelta = getListingPriceDelta(sellPriceWithoutOffsetWithFees, price);

            listingState.set(listing.listingid, {
                sellPrice: sellPriceWithOffset,
                verdict: verdict,
                priceDelta: priceDelta,
            });

            // The verdict is still a class. It styles the listing and it is
            // what the selection buttons match on. The price is not: nothing
            // can style `price_1234` and nothing reads it back any more.
            listingUI.addClass(verdict);

            // The label carries the delta, so the tooltip is free to carry what will not
            // fit beside it: the exact best price, and the price a relist would actually
            // list at once the user's offset is applied. That second number is the one
            // question the label deliberately does not answer -- see ADR 0001.
            $('.market_listing_my_price', listingUI)
                .last()
                .prop(
                    'title',
                    `The best price is ${formatPrice(sellPriceWithoutOffsetWithFees)}. ` +
                        `Relisting would list at ${formatPrice(market.getPriceIncludingFees(sellPriceWithOffset))}.`,
                );

            setListingPriceDeltaLabel(listingUI, formatPriceDelta(priceDelta));

            $('.market_listing_my_price', listingUI)
                .last()
                .css('background', VERDICT_COLORS[verdict]);

            logConsole(VERDICT_MESSAGES[verdict]);

            if (
                verdict == VERDICT_OVERPRICED &&
                getSettingWithDefault(SETTING_RELIST_AUTOMATICALLY) == 1
            ) {
                queueOverpricedItemListing(listing.listingid);
            }

            return callback(true, cachedHistory && cachedListings);
        });
    });
}

export const marketListingsItemsQueue = async.queue((listing: any, next) => {
    const callback = () => {
        increaseMarketProgress();
        setTimeout(() => next(), getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));
    };

    const url = `${window.location.origin}/market/mylistings`;

    const options = {
        method: 'GET',
        data: {
            count: 100,
            start: listing,
        },
        responseType: 'json',
    };

    request(url, options, (error, data) => {
        if (error || !data?.success) {
            callback();
            return;
        }

        const myMarketListings = $('#tabContentsMyActiveMarketListingsRows');

        const nodes = $.parseHTML(data.results_html);
        const rows = $('.market_listing_row', nodes);
        myMarketListings.append(rows);

        // g_rgAssets
        steamPage.mergeAssets(data.assets); // This is a method from Steam.

        callback();
    });
}, 1);

export function fillMarketListingsQueue() {
    $('.market_home_listing_table').each(function (e) {
        // Not for popular / new / recently sold items (bottom of page).
        if ($('.my_market_header', $(this)).length == 0) {
            return;
        }

        // Buy orders and listings confirmations are not grouped like the sell listings, add this so pagination works there as well.
        if (!$(this).attr('id')) {
            $(this).attr('id', `market-listing-${e}`);

            $(this).append(
                `<div class="market_listing_see" id="market-listing-container-${e}"></div>`,
            );
            $('.market_listing_row', $(this)).appendTo($(`#market-listing-container-${e}`));
        } else {
            $(this).children().last().addClass('market_listing_see');
        }

        const marketListing = $('.market_listing_see', this).last();
        if (marketListing[0].childElementCount > 0) {
            addMarketListings(marketListing);
            sortMarketListings($(this), false, false, true);
        }
    });

    let totalSellOrderPriceBuyer = 0;
    let totalSellOrderPriceSeller = 0;
    let totalSellOrderAmount = 0;

    let totalBuyOrderPrice = 0;
    let totalBuyOrderAmount = 0;

    // Add the listings to the queue to be checked for the price.
    marketLists
        .flatMap((list) => list.items)
        .forEach((item) => {
            const isBuyOrder =
                item.elm.id.startsWith('mbuyorder_') || item.elm.id.startsWith('mybuyorder_');
            const isSellOrder = item.elm.id.startsWith('mylisting_');

            if (isSellOrder) {
                const listingid = replaceNonNumbers(item.values().market_listing_item_name);
                const assetInfo = getAssetInfoFromListingId(listingid);

                if (assetInfo.appid === undefined) {
                    logConsole(`Skipping listing ${listingid} (appid not found)`);
                    return;
                }

                totalSellOrderAmount += assetInfo.amount!;

                if (!isNaN(assetInfo.priceBuyer)) {
                    totalSellOrderPriceBuyer += assetInfo.priceBuyer * assetInfo.amount!;
                }
                if (!isNaN(assetInfo.priceSeller)) {
                    totalSellOrderPriceSeller += assetInfo.priceSeller * assetInfo.amount!;
                }

                marketListingsQueue.push({
                    listingid,
                    appid: assetInfo.appid,
                    contextid: assetInfo.contextid,
                    assetid: assetInfo.assetid,
                });

                return;
            }

            if (isBuyOrder) {
                const listingid = replaceNonNumbers(item.values().market_listing_item_name);
                const assetInfo = getAssetInfoFromBuyOrderId(listingid);

                if (assetInfo.amount === undefined) {
                    logConsole(`Skipping listing ${listingid} (amount not found)`);
                    return;
                }

                totalBuyOrderAmount += assetInfo.amount;

                if (!isNaN(assetInfo.price)) {
                    totalBuyOrderPrice += assetInfo.price * assetInfo.amount;
                }

                return;
            }

            logConsole(`Skipping item ${item.elm.id} (not a buy or sell order)`);
        });

    if (totalSellOrderAmount > 0) {
        increaseMarketProgressMax();
    }

    $('#my_market_selllistings_number')
        .append(`<span id="my_market_sell_listings_total_amount"> [${totalSellOrderAmount}]</span>`)
        .append(
            `<span id="my_market_sell_listings_total_price">, ${formatPrice(totalSellOrderPriceBuyer)} ➤ ${formatPrice(totalSellOrderPriceSeller)}</span>`,
        );

    $('#my_market_buylistings_number')
        .append(`<span id="my_market_buy_listings_total_amount"> [${totalBuyOrderAmount}]</span>`)
        .append(
            `<span id="my_market_buy_listings_total_price">, ${formatPrice(totalBuyOrderPrice)}</span>`,
        );
}

// Adds market item listings.
export function addMarketListings(market_listing_see) {
    market_listing_see.addClass('list');

    $('.market_listing_table_header', market_listing_see.parent()).append(
        '<input class="search" id="market_name_search" placeholder="Search..." />',
    );

    const options = {
        valueNames: [
            'market_listing_game_name',
            'market_listing_item_name_link',
            'market_listing_price',
            'market_listing_listed_date',
            {
                name: 'market_listing_item_name',
                attr: 'id',
            },
        ],
    };

    try {
        const list = new List(market_listing_see.parent().get(0), options);
        list.on('searchComplete', updateMarketSelectAllButton);
        list.on('searchComplete', refreshMarketOverpricedButtons);
        marketLists.push(list);
    } catch (e) {
        console.error(e);
    }
}

// Adds checkboxes to market listings.
export function addMarketCheckboxes() {
    $('.market_listing_row').each(function () {
        // Don't add it again, one time is enough.
        if ($('.market_listing_select', this).length == 0) {
            $('.market_listing_cancel_button', $(this)).append(
                '<div class="market_listing_select">' +
                    '<input type="checkbox" class="market_select_item"/>' +
                    '</div>',
            );

            $('.market_select_item', this).change(() => {
                updateMarketSelectAllButton();
            });
        }
    });
}

// Process the market listings.
export function processMarketListings() {
    addMarketCheckboxes();

    if (currentPage == PAGE_MARKET) {
        // Load the market listings.
        let currentCount = 0;
        let totalCount = 0;

        const myListingsTotalCount = steamPage.myListingsTotalCount();
        if (myListingsTotalCount != null) {
            totalCount = myListingsTotalCount;
        } else {
            totalCount = parseInt($('#my_market_selllistings_number').text());
        }

        if (isNaN(totalCount) || totalCount == 0) {
            fillMarketListingsQueue();
            return;
        }

        $('#tabContentsMyActiveMarketListingsRows').html(''); // Clear the default listings.
        $('#tabContentsMyActiveMarketListingsRows').hide(); // Hide all listings until everything has been loaded.

        // Hide Steam's paging controls.
        $('#tabContentsMyActiveMarketListings_ctn').hide();
        $('.market_pagesize_options').hide();

        // Show the spinner so the user knows that something is going on.
        renderSpinner('Loading market listings');

        while (currentCount < totalCount) {
            marketListingsItemsQueue.push(currentCount);
            increaseMarketProgressMax();
            currentCount += 100;
        }
    } else {
        // This is on a market item page.
        $('.market_home_listing_table').each(function () {
            // Not on 'x requests to buy at y,yy or lower'.
            if ($('#market_buyorder_info_show_details', $(this)).length > 0) {
                return;
            }

            $(this).children().last().wrap('<div class="market_listing_see"></div>');
            const marketListing = $('.market_listing_see', this).last();
            const container = $('.market_listing_row', marketListing)?.parent();

            if (
                marketListing[0]?.childElementCount > 0 &&
                container != null &&
                container.length > 0
            ) {
                addMarketListings(container);
                sortMarketListings($(this), false, false, true);
            }
        });

        $('#tabContentsMyActiveMarketListingsRows > .market_listing_row').each(function () {
            const listingid = $(this)
                .attr('id')!
                .replace('mylisting_', '')
                .replace('mybuyorder_', '')
                .replace('mbuyorder_', '');
            const assetInfo = getAssetInfoFromListingId(listingid);

            // There's only one item in the g_rgAssets on a market listing page.
            const existingAsset = steamPage.firstAsset();

            // appid and contextid are identical, only the assetid is different for each asset.
            steamPage.setAsset(
                assetInfo.appid,
                assetInfo.contextid,
                assetInfo.assetid,
                existingAsset,
            );
            marketListingsQueue.push({
                listingid,
                appid: assetInfo.appid,
                contextid: assetInfo.contextid,
                assetid: assetInfo.assetid,
            });
            increaseMarketProgressMax();
        });
    }
}
