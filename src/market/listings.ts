// Reading the market listings page.
//
// Two queues. marketListingsQueue prices each listing so it can be marked overpriced,
// underpriced or fair; marketListingsItemsQueue fetches the item behind each row. The page
// is paginated, so filling the queue means walking the pages Steam has loaded.

import {
    COLOR_PRICE_NOT_CHECKED,
    PAGE_MARKET,
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
} from '../pricing/algorithms.ts';
import { fetchPricingInputs } from '../pricing/inputs.ts';
import { runQueue } from '../queue/index.ts';
import {
    SETTING_PRICE_MIN_CHECK_PRICE,
    SETTING_RELIST_AUTOMATICALLY,
    getSetting,
} from '../settings/index.ts';
import { currentPage, steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
import { removeSpinner, renderSpinner } from '../ui/index.ts';
import { logConsole } from '../ui/logger.ts';
import { replaceNonNumbers } from '../util/numbers.ts';
import {
    getAssetInfoFromBuyOrderId,
    getAssetInfoFromListingId,
    getPriceValueAsInt,
} from './assets.ts';
import { getListingPriceDelta, getListingVerdict, listingState } from './listingState.ts';
import { addWork, workDone } from './progress.ts';
import { queueOverpricedItemListing, refreshMarketOverpricedButtons } from './relist.ts';
import { getListingFromLists, marketLists } from './rows.ts';
import { sortMarketListings } from './sort.ts';
import { updateMarketSelectAllButton } from './ui.ts';
import $ from 'jquery';
import List from 'list.js';
//#region Market
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_MARKET || currentPage == PAGE_MARKET_LISTING
export const marketListingsRelistedAssets: any[] = [];

// Renders the price cell as four labelled quadrants: what the buyer pays, what the seller
// receives, the highest buy order, and the distance from the best price.
//
// Steam's own layout packs three of those four into one string -- `A$ 0.10 ➤ A$ 0.08
// (A$ 0.08)` -- where the arrow and the parentheses are conventions the reader either
// knows or does not. It also breaks: on a high-value listing the price line wraps and the
// fourth value is pushed out of the 50px cell entirely. The grid gives each value a
// caption and a fixed quadrant, so nothing wraps and nothing has to be decoded.
//
// Steam's original `.market_table_value` is *hidden, not removed*, and that is the whole
// safety argument for this function. Three separate readers depend on its exact internal
// shape through positional selectors: `getPriceValueAsInt` in assets.ts reads the listed
// price at `.market_listing_price > span:nth-child(1) > span:nth-child(1)`, `getAssetInfoFromListingId`
// reads the seller price at `span:nth-child(3)` of the same parent, and the price sort in
// sort.ts truncates that element's text at the first `(`. Moving those spans into grid
// cells would shift every nth-child and silently feed the wrong price into the verdict and
// the relist -- nothing would throw. So the original stays exactly where it is and the
// grid is drawn beside it, purely presentational.
//
// The order matters: the grid is built first and Steam's node is hidden only once it is in
// place, so a failure here leaves the user looking at Steam's price rather than an empty
// cell.
//
// Idempotent, because a row can be priced twice -- the queue above retries a failed
// listing once with ignoreErrors set and both attempts reach here.
function renderPriceCellGrid(listingUI, values) {
    const priceCell = $('.market_listing_my_price', listingUI).last();
    const quadrants = [
        { label: 'Listed', value: values.listed, cls: 'see_grid_lead' },
        { label: 'You get', value: values.net, cls: '' },
        { label: 'Buy order', value: values.buyOrder, cls: '' },
        { label: 'vs best', value: values.delta || '—', cls: '' },
    ];

    const grid = $('<div class="see_price_grid"></div>');
    quadrants.forEach((q) => {
        $('<div class="see_grid_cell"></div>')
            .append($('<span class="see_grid_label"></span>').text(q.label))
            .append($(`<span class="see_grid_value ${q.cls}"></span>`).text(q.value))
            .appendTo(grid);
    });

    $('.see_price_grid', priceCell).remove();
    priceCell.append(grid);
    $('.market_table_value', priceCell).addClass('see_hidden');
}

// Puts the cell back the way Steam drew it. The not-checked path returns without pricing,
// so a grid built on an earlier pass would be showing four numbers the script no longer
// stands behind.
function clearPriceCellGrid(listingUI) {
    const priceCell = $('.market_listing_my_price', listingUI).last();

    $('.see_price_grid', priceCell).remove();
    $('.market_table_value', priceCell).removeClass('see_hidden');
}

export const marketListingsQueue = runQueue(marketListingsQueueWorker, {
    retryOnFailure: true,
    retryPlacement: 'front',
    onTaskDone: () => workDone(),
});

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
        price <= getSetting(SETTING_PRICE_MIN_CHECK_PRICE) * 100 ||
        listingUI.hasClass('removing')
    ) {
        $('.market_listing_my_price', listingUI).last().css('background', COLOR_PRICE_NOT_CHECKED);
        $('.market_listing_my_price', listingUI).last().prop('title', 'The price is not checked.');
        // This path returns without pricing, so a grid from an earlier pass is now stale.
        // Put Steam's own price display back rather than leave four numbers under a grey
        // cell that the script no longer stands behind.
        clearPriceCellGrid(listingUI);
        listingUI.addClass('not_checked');

        return callback(true, true);
    }

    const item = {
        appid: parseInt(appid),
        description: {
            market_hash_name: market_hash_name,
        },
    };

    fetchPricingInputs(
        item,
        { history: true, name: game_name },
        ({ history, orderbook, failed, cached }) => {
            if (failed > 0 && !ignoreErrors) {
                return callback(false, cached);
            }

            // Shows the highest buy order price on the market listings.
            // The 'orderbook.highest_buy_order' is not reliable as Steam is caching this value, but it gives some idea for older titles/listings.
            //
            // This used to be appended into Steam's own price span as ` ➤ <price>`. It is
            // now a quadrant of the grid below instead. That is a move rather than a
            // removal, and it takes text back out of `.market_listing_price` -- which the
            // price sort in sort.ts parses by truncating at the first `(` -- so the sort
            // now sees only what Steam wrote.
            const highestBuyOrderPrice =
                orderbook == null || orderbook.highest_buy_order == null
                    ? '-'
                    : formatPrice(orderbook.highest_buy_order);

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
            const rules = createPricingRules(asset);

            const sellPriceWithoutOffset = calculateSellPriceBeforeFees(
                history,
                orderbook,
                false,
                rules,
            );
            const sellPriceWithOffset = calculateSellPriceBeforeFees(
                history,
                orderbook,
                true,
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

            // The two prices Steam itself renders are read back out of its own markup
            // rather than re-formatted from `price`. `price` was parsed *from* that text,
            // so formatting it again would be a round trip through a parser and a locale
            // formatter for no gain -- and any cent it disagreed on would be a cent the
            // user sees change for no reason.
            const steamPrices = $(
                '.market_listing_price > span:nth-child(1)',
                $('.market_listing_my_price', listingUI).last(),
            );

            renderPriceCellGrid(listingUI, {
                listed: $('span:nth-child(1)', steamPrices).text().trim(),
                net: $('span:nth-child(3)', steamPrices).text().trim().replace(/[()]/g, ''),
                buyOrder: highestBuyOrderPrice,
                delta: formatPriceDelta(priceDelta),
            });

            $('.market_listing_my_price', listingUI)
                .last()
                .css('background', VERDICT_COLORS[verdict]);

            logConsole(VERDICT_MESSAGES[verdict]);

            if (verdict == VERDICT_OVERPRICED && getSetting(SETTING_RELIST_AUTOMATICALLY) == 1) {
                queueOverpricedItemListing(listing.listingid);
            }

            return callback(true, cached);
        },
    );
}

// A plain paging walk over the listings page, not a retrying queue -- a failed page is not
// re-fetched, it is just skipped and the walk moves on. Converting it onto runQueue is for
// the delay policy only: a page that fails to load now backs off the same escalating way a
// real failure does anywhere else, instead of waiting the same short jittered gap it would
// have waited on success.
export const marketListingsItemsQueue = runQueue(marketListingsItemsQueueWorker, {
    onTaskDone: () => workDone(),
});

export function marketListingsItemsQueueWorker(task, ignoreErrors, callback) {
    const url = `${window.location.origin}/market/mylistings`;

    const options = {
        method: 'GET',
        data: {
            count: 100,
            start: task.start,
        },
        responseType: 'json',
    };

    request(url, options, (error, data) => {
        if (error || !data?.success) {
            return callback(false);
        }

        const myMarketListings = $('#tabContentsMyActiveMarketListingsRows');

        const nodes = $.parseHTML(data.results_html);
        const rows = $('.market_listing_row', nodes);
        myMarketListings.append(rows);

        // g_rgAssets
        steamPage.mergeAssets(data.assets); // This is a method from Steam.

        callback(true);
    });
}

export function onMarketListingsItemsDrained(): void {
    const myMarketListings = $('#tabContentsMyActiveMarketListingsRows');
    myMarketListings.checkboxes('range', true);

    // Sometimes the Steam API is returning duplicate entries (especially during item listing), filter these.
    const seen: Record<string, boolean> = {};
    $('.market_listing_row', myMarketListings).each(function () {
        const item_id = String($(this).attr('id'));
        if (seen[item_id]) {
            $(this).remove();
        } else {
            seen[item_id] = true;
        }

        // Remove listings awaiting confirmations, they are already listed separately.
        if (
            $('.item_market_action_button', this)
                .attr('href')!
                .toLowerCase()
                .includes('CancelMarketListingConfirmation'.toLowerCase())
        ) {
            $(this).remove();
        }

        // Remove buy order listings, they are already listed separately.
        if (
            $('.item_market_action_button', this)
                .attr('href')!
                .toLowerCase()
                .includes('CancelMarketBuyOrder'.toLowerCase())
        ) {
            $(this).remove();
        }
    });

    // Now add the market checkboxes.
    addMarketCheckboxes();

    // Show the listings again, rendering is done.
    removeSpinner();

    myMarketListings.show();

    fillMarketListingsQueue();
}

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

    // The queue is pushed once per sell listing, not once per assetInfo.amount -- a stacked
    // listing's amount can be more than one while it is still a single row to price. This is
    // the count addWork() below needs; totalSellOrderAmount is a sum of quantities and can
    // overstate it, which is the off-by-N the bar used to show.
    let queuedSellListings = 0;

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
                queuedSellListings += 1;

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

    if (queuedSellListings > 0) {
        addWork(queuedSellListings);
    }

    // The two totals are the same pair the price grid labels on every row: what the buyers
    // pay, and what reaches the seller once Steam takes its cut. They were separated by a
    // ➤ and nothing else, which leaves the reader to guess which direction the arrow means
    // and why the second number is smaller. Naming them costs a few characters and uses
    // the same words as the quadrants, so the summary and the rows agree.
    $('#my_market_selllistings_number')
        .append(`<span id="my_market_sell_listings_total_amount"> [${totalSellOrderAmount}]</span>`)
        .append(
            `<span id="my_market_sell_listings_total_price">, Listed ${formatPrice(totalSellOrderPriceBuyer)} · You get ${formatPrice(totalSellOrderPriceSeller)}</span>`,
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
            marketListingsItemsQueue.push({ start: currentCount });
            addWork(1);
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
            addWork(1);
        });
    }
}
