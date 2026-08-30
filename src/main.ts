// Steam Economy Enhancer -- script body.
//
// Ported verbatim from the single-IIFE code.user.js. The userscript metadata block now
// lives in userscript.config.ts, and the jQuery/async/localforage/luxon/list.js globals
// that were IIFE parameters or bare @require globals are imports, mapped back to those
// same window globals at build time by vite-plugin-monkey's externalGlobals. That mapping
// is what makes $.noConflict(true) below safe: the bundler captures jQuery into a local
// binding before this module body runs, exactly as the IIFE parameter used to.
//
// The module.exports test seam that used to sit at the foot of the file is gone; the same
// names are real ES exports now. Nothing in the userscript entry path imports them, so
// they are tree-shaken out of the built artifact.

import {
    addMarketCheckboxes,
    fillMarketListingsQueue,
    marketListingsItemsQueue,
    marketListingsQueue,
} from './market/listings.ts';
import { resetMarketRelistProgress } from './market/progress.ts';
import { marketOverpricedQueue, refreshMarketOverpricedButtons } from './market/relist.ts';
import { initializeMarketUI } from './market/ui.ts';
import { initializeTradeOfferUI } from './tradeoffer/ui.ts';
import { boosterQueue } from './inventory/boosters.ts';
import { scrapQueue } from './inventory/gems.ts';
import { onQueueDrain } from './inventory/progress.ts';
import { itemQueue, sellQueue } from './inventory/sell.ts';
import { initializeInventoryUI } from './inventory/ui.ts';
import $ from 'jquery';

import { PAGE_INVENTORY, PAGE_MARKET, PAGE_MARKET_LISTING, PAGE_TRADEOFFER } from './constants.ts';
import {
    calculateAverageHistoryPriceBeforeFees,
    calculateBuyOrderPriceBeforeFees,
    calculateListingPriceBeforeFees,
    calculateSellPriceBeforeFees,
    createPricingRules,
    NO_LISTING_PRICE_SENTINEL,
} from './pricing/algorithms.ts';
import { currentPage, isLoggedIn } from './steam/instance.ts';
import { buildOrderBook } from './steam/market.ts';
import { injectCss, markRow, removeSpinner } from './ui/index.ts';
import {
    REQUEST_BREAKER_STATUSES,
    REQUEST_BREAKER_THRESHOLD,
    REQUEST_BREAKER_WINDOW_MS,
    REQUEST_DELAY_DEFAULT,
    REQUEST_DELAY_ERROR,
    REQUEST_DELAY_MARKET,
} from './net/request.ts';

// Vendored jQuery plugins, previously @require'd from raw.githubusercontent.com. Both
// attach to the jQuery global at evaluation time, which -- because ES imports are
// evaluated before the module body -- is still before $.noConflict(true) runs below.
import './vendor/jquery-observe.js';
import './vendor/jquery.checkboxes.js';

$.noConflict(true);

// Everything Steam's own page exposes, in one place. `unsafeWindow` global reach-ins used
// to happen at ~44 sites across the whole file: this is what caused the bug fixed in
// PR #334, where Steam changed which DOM element the sell listings' header actually was
// and `$('.my_market_header').first()` silently grabbed the wrong one. Nothing failed;
// the Relist/Select buttons just stopped appearing.
//
// createSteamPage(win) is the live adapter, built once from unsafeWindow at load time.
// A second, fixture adapter (createFixtureSteamPage, in test/steam-page-fixture.js)
// implements the same shape from data instead of a real page, so a change to the shape
// this file expects Steam's page to have can be caught by a test rather than by a user
// reporting silence. See test/steam-page.test.js.

// transport is the one adapter this function needed to become testable: everything else
// - the delay policy (getRequestDelay), the breaker policy (REQUEST_BREAKER_*,
// stopRequests) - was already a plain value or a pure function, not something request()
// held itself. transport is not: $.ajax is a real network call, so it is a parameter
// instead, defaulting to $.ajax for every existing call site. A fake transport in tests
// takes the same jQuery-ajax-shaped settings object and answers success/error/complete
// itself, so request()'s own queueing, pending flag and breaker can be exercised with a
// fake clock and no network - see test/request.test.js.

//#endregion

//#region Storage

//#endregion

//#endregion

//#endregion

// Whether an item has already been queued for an inventory action (sell, turn into
// gems, unpack), kept by asset key instead of on the item itself. readInventoryItems
// used to stamp `item.queued` directly onto Steam's own object, so a second pass over
// the same inventory - the user clicking "Sell All" and "Turn Into Gems" moments apart -
// saw the flag on the very same object and skipped it. readInventoryItems now returns a
// new object every call, so that no longer works; this is where the flag lives instead.

//#endregion

//#endregion

//#region Steam Market

//#endregion

//#region Steam Market / Inventory helpers

//#endregion

//#region Inventory
// --- Page-scoped code, hoisted to module scope ------------------------------------------
//
// In code.user.js this section was wrapped in `if (currentPage == ...) { ... }`. That worked
// only because the file was one sloppy-mode IIFE: Annex B semantics hoisted function
// declarations out of the block up to function scope, so the initializeInventoryUI() /
// initializeMarketUI() / initializeTradeOfferUI() dispatch at the foot of the file could see
// them. An ES module is always strict mode, where the same declarations are block-scoped and
// invisible outside the block -- the bundler correctly removed them as unused and left the
// dispatch calling names that no longer existed. Hoisting restores the original semantics.
//
// The page gate is unchanged: it lives in that dispatch, not here. The only thing that now
// evaluates on every page is this section's inert declarations -- async.queue()/runQueue()
// objects, counters and a Set -- none of which touch the DOM, the network or Steam's page,
// and none of which anything pushes to unless the dispatch runs.
// Original guard: currentPage == PAGE_INVENTORY

sellQueue.drain(() => {
    onQueueDrain();
});

scrapQueue.drain(() => {
    onQueueDrain();
});

boosterQueue.drain(() => {
    onQueueDrain();
});

// itemQueue feeds sellQueue but never triggered onQueueDrain itself; only sellQueue
// finishing did, relying on it always draining after the last item itemQueue produced.
// True in practice, but only by luck of the two queues' relative timing. Registered
// directly now, like the other three queues onQueueDrain checks.
itemQueue.drain(() => {
    onQueueDrain();
});

//#endregion

//#region Inventory + Tradeoffer
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_INVENTORY || currentPage == PAGE_TRADEOFFER

//#endregion

// Automatic relisting feeds this queue while the pricing pass is still finding
// overpriced listings, so it drains every time it happens to catch up with the pass.
// Clearing the progress there restarts the count from zero halfway through the run,
// so the queue that finishes last is the one that clears it.
marketOverpricedQueue.drain(() => {
    if (!marketListingsQueue.idle()) {
        refreshMarketOverpricedButtons();

        return;
    }

    resetMarketRelistProgress();
});

// The other half of the same rule: the pricing pass can finish after the last relist
// it queued is already done, and then nothing else is left to clear the progress.
marketListingsQueue.drain(() => {
    if (!marketOverpricedQueue.idle()) {
        return;
    }

    resetMarketRelistProgress();
});

marketListingsItemsQueue.drain(() => {
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
});

//#endregion

//#endregion

//#endregion

//#region UI
injectCss(`
    .ui-selected { outline: 2px dashed #FFFFFF; }
    #logger { color: #767676; font-size: 12px;margin-top:16px; max-height: 200px; overflow-y: auto; }
    .trade_offer_sum { color: #767676; font-size: 12px; margin-top:8px; user-select: text; }
    .trade_offer_buttons { margin-top: 12px; }
    .market_commodity_orders_table { font-size:12px; font-family: "Motiva Sans", Sans-serif; font-weight: 300; }
    .market_commodity_orders_table th { padding-left: 10px; }
    #listings_group { display: flex; justify-content: space-between; margin-bottom: 8px; }
    #listings_sell { text-align: right; color: #589328; font-weight:600; }
    #listings_buy { text-align: right; color: #589328; font-weight:600; }
    .market_listing_my_price { height: 50px; padding-right:6px; }
    /* The priced cell as four labelled quadrants. The grid owns the whole 50px box, which
       is what stops the old stacked layout from spilling into the next row: Steam gives
       the cell line-height:50px, so a block appended after its inline-block value started
       below the cell entirely, and a long price (A$ 128.00 -> A$ 104.55) wrapped and pushed
       the last value out. A fixed 2x2 with nowrap values cannot do either.
       .see_hidden keeps Steam's own markup in the DOM -- three positional selectors read
       the prices back out of it -- while taking it off the screen. */
    .see_hidden { display: none !important; }
    /* The column gap is 2px rather than 6px to pay for the 2px left pad and then some.
       A quadrant gets (121 - 2 - gap) / 2 of the cell, and a bold A$ 128.00 needs 56px:
       at a 6px gap it had 55 and clipped by a pixel even before the pad existed. Short
       values leave the columns looking generously spaced regardless; it is only at four
       figures that the gap is doing any work. */
    .see_price_grid { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 1fr 1fr;
        height: 50px; padding: 3px 0 3px 2px; box-sizing: border-box; line-height: 1.05; text-align: left; gap: 0 2px; }
    .see_grid_cell { display: flex; flex-direction: column; justify-content: center; overflow: hidden; }
    .see_grid_label { font-size: 8px; text-transform: uppercase; letter-spacing: 0.4px; color: rgba(255,255,255,0.55); }
    .see_grid_value { font-size: 11px; white-space: nowrap; }
    .see_grid_lead { color: #fff; font-weight: 600; }
    .market_listing_edit_buttons.actual_content { width:276px; transition-property: background-color, border-color; transition-timing-function: linear; transition-duration: 0.5s;}
    .market_listing_buttons { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; padding: 5px; background: rgba(0, 0, 0, 0.4); }
    .market_listing_label_right { float:right; font-size:12px; margin-top:1px; }
    .market_listing_select { position: absolute; top: 16px;right: 10px; display: flex; }
    #market_listing_relist { vertical-align: middle; position: relative; bottom: -1px; right: 2px; }
    .pick_and_sell_button > a { vertical-align: middle; }
    .market_relist_auto { margin-bottom: 8px;  }
    .market_relist_auto_label { margin-right: 6px; }
    .quick_sell { margin-right: 4px; }

    .spinner {margin:10px auto;width:50px;height:40px;text-align:center;font-size:10px;}
    .spinner > div {background-color:#ccc;height:100%;width:6px;display:inline-block;animation:sk-stretchdelay 1.2s infinite ease-in-out}
    .spinner .rect2 {animation-delay:-1.1s}
    .spinner .rect3 {animation-delay:-1s}
    .spinner .rect4 {animation-delay:-.9s}
    .spinner .rect5 {animation-delay:-.8s}
    @keyframes sk-stretchdelay {
        0%,40%,100% {transform:scaleY(0.4);}
        20% {transform:scaleY(1.0);}
    }

    #market_name_search { float: right; background: rgba(0, 0, 0, 0.25); color: white; border: none;height: 25px; padding-left: 6px;}
    .price_option_price { width: 100px }
    .inventory_item_price { top: 0px;position: absolute;right: 0;background: #3571a5;padding: 2px;color: white; font-size:11px; border: 1px solid #666666;}

    .see_inventory_buttons {display:flex;flex-wrap:wrap;gap:10px;align-items:start;}
    .see_inventory_buttons > .see_inventory_buttons, .see_inventory_buttons > #inventory_items_spinner {flex-basis: 100%;}
    #see_market_progress { display: block; width: 50%; height: 20px; }
    #see_market_progress[hidden] { visibility: hidden; }
    .item_market_action_button.see_button_busy { pointer-events: none; opacity: 0.6; cursor: default; }

    #see_settings { background: #26566c; margin-right: 10px; height: 24px; line-height:24px; display:inline-block; padding: 0px 6px; }
    #see_settings_modal select, #see_settings_modal input[type="number"] { background-color: black; color: white; border: transparent; padding: 4px 8px; }
    #see_settings_modal input[type="number"] { width: 100px; }
    #see_settings_modal input[type="checkbox"] { width: 16px; height: 16px; vertical-align: middle; accent-color: #000; }

    #see_page_jump { margin-left: 15px; display: inline-block; }
    #see_page_jump > input { width: 60px; margin-right: 8px; background-color: #1b2838; color: #fff; border: 1px solid #4582a5; padding: 2px 5px; }
`);

$(document).ready(() => {
    // Make sure the user is logged in, there's not much we can do otherwise.
    if (!isLoggedIn) {
        return;
    }

    if (currentPage == PAGE_INVENTORY) {
        initializeInventoryUI();
    }

    if (currentPage == PAGE_MARKET || currentPage == PAGE_MARKET_LISTING) {
        initializeMarketUI();
    }

    if (currentPage == PAGE_TRADEOFFER) {
        initializeTradeOfferUI();
    }
});

$.fn.delayedEach = function (timeout, callback, continuous) {
    const $els = this;
    const iterator = function (index) {
        if (index >= $els.length) {
            if (!continuous) {
                return;
            }
            index = 0;
        }

        const cur = $els[index];
        callback.call(cur, index, cur);

        setTimeout(() => {
            iterator(++index);
        }, timeout);
    };

    iterator(0);
};
//#endregion

//#region Exports
// The shape request() attaches to the Error it hands callers. Exported as a type so tests
// can assert on .statusCode/.responseText without casting the contract away.
export type { RequestError } from './net/request.ts';

// Real ES exports replacing the old `typeof module !== 'undefined'` test seam. Same names,
// same contract: anything listed here must be callable without a page, a network or a
// logged-in Steam session.

export const requestPolicy = {
    REQUEST_BREAKER_STATUSES,
    REQUEST_BREAKER_THRESHOLD,
    REQUEST_BREAKER_WINDOW_MS,
    REQUEST_DELAY_DEFAULT,
    REQUEST_DELAY_ERROR,
    REQUEST_DELAY_MARKET,
};

export {
    buildOrderBook,
    calculateAverageHistoryPriceBeforeFees,
    calculateBuyOrderPriceBeforeFees,
    calculateListingPriceBeforeFees,
    calculateSellPriceBeforeFees,
    createPricingRules,
    markRow,
    NO_LISTING_PRICE_SENTINEL,
};

// Re-exported from the modules they now live in, so the test suite can keep reaching
// them through the entry point while the split is in progress.
export { ROW_STATUS_COLORS } from './constants.ts';

export {
    flattenItem,
    getAssetKey,
    getIsCrate,
    getIsFoilTradingCard,
    getIsTradingCard,
    getMarketHashName,
    isItemQueued,
    markItemQueued,
    readInventoryItems,
} from './items/index.ts';

export {
    createListingState,
    getListingPriceDelta,
    getListingVerdict,
} from './market/listingState.ts';

export { formatPriceDelta } from './pricing/algorithms.ts';

export { market } from './steam/market.ts';

export {
    getRequestDelay,
    getRequestStoppedMessage,
    isRetryMessage,
    request,
    stopRequests,
} from './net/request.ts';

export {
    CalculateAmountToSendForDesiredReceivedAmount,
    CalculateFeeAmount,
    clamp,
    priceBeforeFees,
    priceIncludingFees,
} from './pricing/fees.ts';

export {
    createFailureCounter,
    nextQueueStep,
    nextRetryDelay,
    resetRetryDelay,
    runQueue,
} from './queue/index.ts';

export { createSteamPage, pickSellListingsHeader } from './steam/page.ts';

export { aggregateTradeOfferAssets } from './tradeoffer/totals.ts';

export { sumTradeOfferAssets } from './tradeoffer/ui.ts';

export { getNumberOfDigits, padLeftZero, replaceNonNumbers } from './util/numbers.ts';
//#endregion
