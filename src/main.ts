// Steam Economy Enhancer -- script body.
//
// Ported verbatim from the single-IIFE code.user.js. The userscript metadata block now
// lives in userscript.config.ts, and the jQuery/async/localforage/luxon/list.js globals
// that were IIFE parameters or bare @require globals are imports, mapped back to those
// same window globals at build time by vite-plugin-monkey's externalGlobals. That mapping
// is what makes $.noConflict(true) below safe: the bundler captures jQuery into a local
// binding before this module body runs, exactly as the IIFE parameter used to.
//
// Importing this module now runs only that jQuery handoff and the two vendored plugins'
// own attach-to-jQuery side effects below -- both have to happen at module-evaluation time,
// see the comment above them. Everything else the userscript does at startup lives in
// bootstrap(), called once from src/entry.ts, the vite entry point. That split is what lets
// a test import this module -- as test/bootstrap.test.ts does -- without booting a page.
//
// This file no longer re-exports the rest of the feature modules for the test suite: each
// test file now imports the module it exercises directly (test/inventory-selection.test.ts
// was the original precedent), so the only thing left for the userscript's own entry to
// import here is bootstrap() itself.

import {
    marketListingsItemsQueue,
    marketListingsQueue,
    onMarketListingsItemsDrained,
} from './market/listings.ts';
import { onMarketListingsQueueDrained, onMarketOverpricedQueueDrained } from './market/progress.ts';
import { marketOverpricedQueue } from './market/relist.ts';
import { initializeMarketUI } from './market/ui.ts';
import { initializeTradeOfferUI } from './tradeoffer/ui.ts';
import { boosterQueue } from './inventory/boosters.ts';
import { scrapQueue } from './inventory/gems.ts';
import { onQueueDrain } from './inventory/progress.ts';
import { itemQueue, sellQueue } from './inventory/sell.ts';
import { initializeInventoryUI } from './inventory/ui.ts';
import $ from 'jquery';

import { PAGE_INVENTORY, PAGE_MARKET, PAGE_MARKET_LISTING, PAGE_TRADEOFFER } from './constants.ts';
import { currentPage, isLoggedIn } from './steam/instance.ts';
import { injectCss } from './ui/index.ts';

// Vendored jQuery plugins, previously @require'd from raw.githubusercontent.com. Both
// attach to the jQuery global at evaluation time, which -- because ES imports are
// evaluated before the module body -- is still before $.noConflict(true) runs below.
import './vendor/jquery-observe.js';
import './vendor/jquery.checkboxes.js';

$.noConflict(true);

/**
 * Everything the userscript does at startup: registering the queue drains, injecting the
 * stylesheet, and running the page dispatch. Called once, from src/entry.ts. Kept separate
 * from module-evaluation so importing src/main.ts -- as the test suite does, for its
 * exports -- never touches the DOM, the network or Steam's page.
 */
export function bootstrap(): void {
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

    sellQueue.drain(onQueueDrain);
    scrapQueue.drain(onQueueDrain);
    boosterQueue.drain(onQueueDrain);

    // itemQueue feeds sellQueue but never triggered onQueueDrain itself; only sellQueue
    // finishing did, relying on it always draining after the last item itemQueue produced.
    // True in practice, but only by luck of the two queues' relative timing. Registered
    // directly now, like the other three queues onQueueDrain checks.
    itemQueue.drain(onQueueDrain);

    //#endregion

    marketOverpricedQueue.drain(onMarketOverpricedQueueDrained);
    marketListingsQueue.drain(onMarketListingsQueueDrained);
    marketListingsItemsQueue.drain(onMarketListingsItemsDrained);

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

        /* The "for sale" ribbon on an inventory tile whose listing succeeded -- see
           markRowForSale in src/ui/index.ts. The band is clipped by its own 78px corner box
           rather than by overflow:hidden on the tile, so anything Steam draws outside the
           tile's bounds still shows.
           The band is the listed-green #407736 markRow paints for the same event. A dark
           band was tried and dropped: it reads well against the green fill, but Steam's own
           tile is #3b3b3b and a good many item icons are dark themselves, so on everything
           except a freshly listed tile it disappeared. What separates it from the green fill
           underneath is the light top edge and the shadow, not a colour of its own. */
        .see_for_sale { position: absolute; top: 0; right: 0; width: 78px; height: 78px;
            overflow: hidden; pointer-events: none; z-index: 2; }
        .see_for_sale b { position: absolute; display: block; width: 120px; right: -32px; top: 15px;
            padding: 3px 0; text-align: center; transform: rotate(45deg); font-size: 8px;
            font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: #fff;
            background: rgba(64, 119, 54, 0.97); border-top: 1px solid rgba(255, 255, 255, 0.4);
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.6); }

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
    //#endregion
}
