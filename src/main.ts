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

import $ from 'jquery';
import async from 'async';
import * as luxon from 'luxon';
import List from 'list.js';

import {
    COLOR_ERROR,
    COLOR_PENDING,
    COLOR_PRICE_NOT_CHECKED,
    COLOR_SUCCESS,
    ERROR_SUCCESS,
    PAGE_INVENTORY,
    PAGE_MARKET,
    PAGE_MARKET_LISTING,
    PAGE_TRADEOFFER,
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
    RETRY_DELAY_SHORT_MAX,
    RETRY_DELAY_SHORT_MIN,
    VERDICT_COLORS,
    VERDICT_MESSAGES,
    VERDICT_OVERPRICED,
} from './constants.ts';
import {
    calculateAverageHistoryPriceBeforeFees,
    calculateBuyOrderPriceBeforeFees,
    calculateListingPriceBeforeFees,
    calculateSellPriceBeforeFees,
    createPricingRules,
    formatPrice,
    getPriceInformationFromItem,
    NO_LISTING_PRICE_SENTINEL,
} from './pricing/algorithms.ts';
import { currentPage, isLoggedIn, steamPage } from './steam/instance.ts';
import { buildOrderBook, market } from './steam/market.ts';
import { injectCss, markRow, removeSpinner, renderSpinner } from './ui/index.ts';
import { isRetryMessage, request } from './net/request.ts';
import {
    SETTING_MIN_NORMAL_PRICE,
    SETTING_MAX_NORMAL_PRICE,
    SETTING_MIN_FOIL_PRICE,
    SETTING_MAX_FOIL_PRICE,
    SETTING_MIN_MISC_PRICE,
    SETTING_MAX_MISC_PRICE,
    SETTING_PRICE_OFFSET,
    SETTING_PRICE_MIN_CHECK_PRICE,
    SETTING_PRICE_MIN_LIST_PRICE,
    SETTING_PRICE_ALGORITHM,
    SETTING_PRICE_IGNORE_LOWEST_Q,
    SETTING_PRICE_HISTORY_HOURS,
    SETTING_INVENTORY_PRICE_LABELS,
    SETTING_TRADEOFFER_PRICE_LABELS,
    SETTING_QUICK_SELL_BUTTONS,
    SETTING_RELIST_AUTOMATICALLY,
    getSettingWithDefault,
    setSetting,
} from './settings/index.ts';
import { aggregateTradeOfferAssets } from './tradeoffer/totals.ts';
import { createListingState, getListingVerdict } from './market/listingState.ts';
import {
    flattenItem,
    readInventoryItems,
    getMarketHashName,
    getIsCrate,
    getIsTradingCard,
    getAssetKey,
    isItemQueued,
    markItemQueued,
} from './items/index.ts';
import {
    REQUEST_BREAKER_STATUSES,
    REQUEST_BREAKER_THRESHOLD,
    REQUEST_BREAKER_WINDOW_MS,
    REQUEST_DELAY_DEFAULT,
    REQUEST_DELAY_ERROR,
    REQUEST_DELAY_MARKET,
} from './net/request.ts';
import type { QueueTask } from './queue/index.ts';
import { logDOM, logConsole, logger, setUserScrolled } from './ui/logger.ts';
import { runQueue } from './queue/index.ts';
import { getRandomInt, getNumberOfDigits, padLeftZero, replaceNonNumbers } from './util/numbers.ts';

// Vendored jQuery plugins, previously @require'd from raw.githubusercontent.com. Both
// attach to the jQuery global at evaluation time, which -- because ES imports are
// evaluated before the module body -- is still before $.noConflict(true) runs below.
import './vendor/jquery-observe.js';
import './vendor/jquery.checkboxes.js';

$.noConflict(true);

const marketLists: any[] = [];
let totalNumberOfProcessedQueueItems = 0;
let totalNumberOfQueuedItems = 0;
let totalPriceWithFeesOnMarket = 0;
let totalPriceWithoutFeesOnMarket = 0;
let totalScrap = 0;

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

// One store for the page. The market listings and the trade offer inventory are never
// both on screen, so they cannot collide, and the keys differ anyway.
const listingState = createListingState();

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

function onQueueDrain() {
    if (
        itemQueue.length() == 0 &&
        sellQueue.length() == 0 &&
        scrapQueue.length() == 0 &&
        boosterQueue.length() == 0
    ) {
        removeSpinner();
    }
}

function updateTotals() {
    if ($('#loggerTotal').length == 0) {
        $(logger).parent().append('<div id="loggerTotal"></div>');
    }

    const totals = document.getElementById('loggerTotal');
    totals.innerHTML = '';

    if (totalPriceWithFeesOnMarket > 0) {
        totals.innerHTML += `<div><strong>Total listed for ${formatPrice(totalPriceWithFeesOnMarket)}, you will receive ${formatPrice(totalPriceWithoutFeesOnMarket)}.</strong></div>`;
    }
    if (totalScrap > 0) {
        totals.innerHTML += `<div><strong>Total scrap ${totalScrap}.</strong></div>`;
    }
}

const sellQueue = async.queue((task: QueueTask, next) => {
    totalNumberOfProcessedQueueItems++;

    const digits = getNumberOfDigits(totalNumberOfQueuedItems);
    const itemId = task.item.assetid || task.item.id;
    const itemName = task.item.name || task.item.description.name;
    const itemNameWithAmount =
        task.item.amount == 1 ? itemName : `${task.item.amount}x ${itemName}`;
    const padLeft = `${padLeftZero(`${totalNumberOfProcessedQueueItems}`, digits)} / ${totalNumberOfQueuedItems}`;

    if (
        getSettingWithDefault(SETTING_PRICE_MIN_LIST_PRICE) * 100 >=
        market.getPriceIncludingFees(task.sellPrice)
    ) {
        logDOM(`${padLeft} - ${itemNameWithAmount} is not listed due to ignoring price settings.`);
        markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'notChecked');
        next();
        return;
    }

    market.sellItem(task.item, task.sellPrice, (error, data) => {
        const success = Boolean(data?.success);
        const message = data?.message || '';

        const callback = () =>
            setTimeout(() => next(), getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));

        if (success) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} listed for ${formatPrice(market.getPriceIncludingFees(task.sellPrice) * task.item.amount)}, you will receive ${formatPrice(task.sellPrice * task.item.amount)}.`,
            );
            markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'success');

            totalPriceWithoutFeesOnMarket += task.sellPrice * task.item.amount;
            totalPriceWithFeesOnMarket +=
                market.getPriceIncludingFees(task.sellPrice) * task.item.amount;

            updateTotals();
            callback();

            return;
        }

        if (message && isRetryMessage(message)) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} retrying listing because: ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
            );

            totalNumberOfProcessedQueueItems--;
            sellQueue.unshift(task);
            sellQueue.pause();

            setTimeout(
                () => sellQueue.resume(),
                getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
            callback();

            return;
        }

        logDOM(
            `${padLeft} - ${itemNameWithAmount} not added to market${message ? ` because:  ${message.charAt(0).toLowerCase()}${message.slice(1)}` : '.'}`,
        );
        markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'error');

        callback();
    });
}, 1);

sellQueue.drain(() => {
    onQueueDrain();
});

function sellAllItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            filteredItems.push(item);
        });

        sellItems(filteredItems);
    });
}

function sellAllDuplicateItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const marketableItems: any[] = [];
        let filteredItems = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            marketableItems.push(item);
        });

        filteredItems = marketableItems.filter(
            (e, i) => marketableItems.map((m) => m.classid).indexOf(e.classid) !== i,
        );

        sellItems(filteredItems);
    });
}

function gemAllDuplicateItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        let filteredItems = [];
        let numberOfQueuedItems = 0;

        filteredItems = items.filter(
            (e, i) => items.map((m) => m.classid).indexOf(e.classid) !== i,
        );

        filteredItems.forEach((item) => {
            if (isItemQueued(item)) {
                return;
            }

            if (item.owner_actions == null) {
                return;
            }

            let canTurnIntoGems = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('GetGooValue')
                ) {
                    canTurnIntoGems = true;
                }
            }

            if (!canTurnIntoGems) {
                return;
            }

            markItemQueued(item);
            scrapQueue.push(item);
            numberOfQueuedItems++;
        });

        if (numberOfQueuedItems > 0) {
            totalNumberOfQueuedItems += numberOfQueuedItems;

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

function sellAllCards() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            if (!getIsTradingCard(item) || !item.marketable) {
                return;
            }

            filteredItems.push(item);
        });

        sellItems(filteredItems);
    });
}

function sellAllCrates() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const filteredItems: any[] = [];
        items.forEach((item) => {
            if (!getIsCrate(item) || !item.marketable) {
                return;
            }
            filteredItems.push(item);
        });

        sellItems(filteredItems);
    });
}

const scrapQueue = runQueue(scrapQueueWorker, { successDelayMs: 250 });

scrapQueue.drain(() => {
    onQueueDrain();
});

function scrapQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;
    const itemId = item.assetid || item.id;

    market.getGooValue(item, (err, goo) => {
        totalNumberOfProcessedQueueItems++;

        const digits = getNumberOfDigits(totalNumberOfQueuedItems);
        const padLeft = `${padLeftZero(`${totalNumberOfProcessedQueueItems}`, digits)} / ${totalNumberOfQueuedItems}`;

        if (err != ERROR_SUCCESS) {
            logConsole(`Failed to get gems value for ${itemName}`);
            logDOM(`${padLeft} - ${itemName} not turned into gems due to missing gems value.`);

            markRow(`${item.appid}_${item.contextid}_${itemId}`, 'error');
            return callback(false);
        }

        const gooValueExpected = parseInt(goo.goo_value, 10);

        market.grindIntoGoo(item, gooValueExpected, (err) => {
            if (err != ERROR_SUCCESS) {
                logConsole(`Failed to turn item into gems for ${itemName}`);
                logDOM(`${padLeft} - ${itemName} not turned into gems due to unknown error.`);

                markRow(`${item.appid}_${item.contextid}_${itemId}`, 'error');
                return callback(false);
            }

            logConsole('============================');
            logConsole(itemName);
            logConsole(`Turned into ${goo.goo_value} gems`);
            logDOM(`${padLeft} - ${itemName} turned into ${gooValueExpected} gems.`);
            markRow(`${item.appid}_${item.contextid}_${itemId}`, 'success');

            totalScrap += gooValueExpected;
            updateTotals();

            callback(true);
        });
    });
}

const boosterQueue = runQueue(boosterQueueWorker, { successDelayMs: 250 });

boosterQueue.drain(() => {
    onQueueDrain();
});

function boosterQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;
    const itemId = item.assetid || item.id;

    market.unpackBoosterPack(item, (err) => {
        totalNumberOfProcessedQueueItems++;

        const digits = getNumberOfDigits(totalNumberOfQueuedItems);
        const padLeft = `${padLeftZero(`${totalNumberOfProcessedQueueItems}`, digits)} / ${totalNumberOfQueuedItems}`;

        if (err != ERROR_SUCCESS) {
            logConsole(`Failed to unpack booster pack ${itemName}`);
            logDOM(`${padLeft} - ${itemName} not unpacked.`);

            markRow(`${item.appid}_${item.contextid}_${itemId}`, 'error');
            return callback(false);
        }

        logDOM(`${padLeft} - ${itemName} unpacked.`);
        markRow(`${item.appid}_${item.contextid}_${itemId}`, 'success');

        callback(true);
    });
}

// Turns the selected items into gems.
function turnSelectedItemsIntoGems() {
    const ids = getSelectedItems();

    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();

        let numberOfQueuedItems = 0;
        items.forEach((item) => {
            // Ignored queued items.
            if (isItemQueued(item)) {
                return;
            }

            if (item.owner_actions == null) {
                return;
            }

            let canTurnIntoGems = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('GetGooValue')
                ) {
                    canTurnIntoGems = true;
                }
            }

            if (!canTurnIntoGems) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                markItemQueued(item);
                scrapQueue.push(item);
                numberOfQueuedItems++;
            }
        });

        if (numberOfQueuedItems > 0) {
            totalNumberOfQueuedItems += numberOfQueuedItems;

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

// Unpacks all booster packs.
function unpackAllBoosterPacks() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();

        let numberOfQueuedItems = 0;

        items.forEach((item) => {
            if (isItemQueued(item) || item.owner_actions == null) {
                return;
            }

            let canOpenBooster = false;

            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('OpenBooster')
                ) {
                    canOpenBooster = true;
                }
            }

            if (!canOpenBooster) {
                return;
            }

            markItemQueued(item);
            boosterQueue.push(item);
            numberOfQueuedItems++;
        });

        if (numberOfQueuedItems === 0) {
            logDOM('No booster packs found in the inventory to unpack.');

            return;
        }

        totalNumberOfQueuedItems += numberOfQueuedItems;

        renderSpinner(`Processing ${numberOfQueuedItems} items`);
    });
}

// Unpacks the selected booster packs.
function unpackSelectedBoosterPacks() {
    const ids = getSelectedItems();

    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();

        let numberOfQueuedItems = 0;
        items.forEach((item) => {
            // Ignored queued items.
            if (isItemQueued(item) || item.owner_actions == null) {
                return;
            }

            let canOpenBooster = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('OpenBooster')
                ) {
                    canOpenBooster = true;
                }
            }

            if (!canOpenBooster) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                markItemQueued(item);
                boosterQueue.push(item);
                numberOfQueuedItems++;
            }
        });

        if (numberOfQueuedItems > 0) {
            totalNumberOfQueuedItems += numberOfQueuedItems;

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

function sellSelectedItems() {
    getInventorySelectedMarketableItems((items) => {
        sellItems(items);
    });
}

function canSellSelectedItemsManually(items) {
    // We have to construct an URL like this
    // https://steamcommunity.com/market/multisell?appid=730&contextid=2&items[]=Falchion%20Case&qty[]=100
    const contextid = items[0].contextid;
    let hasInvalidItem = false;

    items.forEach((item) => {
        if (item.contextid != contextid || item.commodity == false) {
            hasInvalidItem = true;
        }
    });

    return !hasInvalidItem;
}

function sellSelectedItemsManually() {
    getInventorySelectedMarketableItems((items) => {
        // We have to construct an URL like this
        // https://steamcommunity.com/market/multisell?appid=730&contextid=2&items[]=Falchion%20Case&qty[]=100

        const appid = items[0].appid;
        const contextid = items[0].contextid;

        const itemsWithQty = {};

        items.forEach((item) => {
            itemsWithQty[item.market_hash_name] = itemsWithQty[item.market_hash_name] + 1 || 1;
        });

        let itemsString = '';
        for (const itemName in itemsWithQty) {
            itemsString += `&items[]=${encodeURIComponent(itemName)}&qty[]=${itemsWithQty[itemName]}`;
        }

        const baseUrl = `${window.location.origin}/market/multisell`;
        const redirectUrl = `${baseUrl}?appid=${appid}&contextid=${contextid}${itemsString}`;

        const dialog = steamPage.showDialog(
            'Steam Economy Enhancer',
            `<iframe frameBorder="0" height="650" width="900" src="${redirectUrl}"></iframe>`,
        );
        dialog.OnDismiss(() => {
            items.forEach((item) => {
                const itemId = item.assetid || item.id;
                markRow(`${item.appid}_${item.contextid}_${itemId}`, 'pending');
            });
        });
    });
}

function sellItems(items) {
    if (items.length == 0) {
        logDOM('These items cannot be added to the market...');

        return;
    }

    let numberOfQueuedItems = 0;

    items.forEach((item) => {
        // Ignored queued items.
        if (isItemQueued(item)) {
            return;
        }

        markItemQueued(item);
        // item.ignoreErrors starts undefined, which reads the same as false to
        // runQueue's retryOnFailure check - no need to initialise it explicitly on a
        // freshly-read item the way there was when items were mutated in place.
        itemQueue.push(item);
        numberOfQueuedItems++;
    });

    if (numberOfQueuedItems > 0) {
        totalNumberOfQueuedItems += numberOfQueuedItems;

        renderSpinner(`Processing ${numberOfQueuedItems} items`);
    }
}

// A cached answer never reached Steam, and its delay is discarded, so it says
// nothing about the connection either way - see nextQueueStep. A failed item gets
// one more try with ignoreErrors forced true before it is dropped.
const itemQueue = runQueue(itemQueueWorker, { retryOnFailure: true });

// itemQueue feeds sellQueue but never triggered onQueueDrain itself; only sellQueue
// finishing did, relying on it always draining after the last item itemQueue produced.
// True in practice, but only by luck of the two queues' relative timing. Registered
// directly now, like the other three queues onQueueDrain checks.
itemQueue.drain(() => {
    onQueueDrain();
});

function itemQueueWorker(item, ignoreErrors, callback) {
    const priceInfo = getPriceInformationFromItem(item);

    let failed = 0;
    const itemName = item.name || item.description.name;

    market.getPriceHistory(item, true, (err, history, cachedHistory) => {
        if (err) {
            logConsole(`Failed to get price history for ${itemName}`);

            if (err != ERROR_SUCCESS) {
                failed += 1;
            }
        }

        market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
            if (err) {
                logConsole(`Failed to get order book for ${itemName}`);

                if (err != ERROR_SUCCESS) {
                    failed += 1;
                }
            }

            if (failed > 0 && !ignoreErrors) {
                return callback(false, cachedHistory && cachedListings);
            }

            logConsole('============================');
            logConsole(itemName);

            const sellPrice = calculateSellPriceBeforeFees(
                history,
                orderbook,
                true,
                priceInfo.minPriceBeforeFees,
                priceInfo.maxPriceBeforeFees,
                createPricingRules(),
            );

            logConsole(
                `Sell price: ${sellPrice / 100.0} (${market.getPriceIncludingFees(sellPrice) / 100.0})`,
            );

            sellQueue.push({
                item: item,
                sellPrice: sellPrice,
            });

            return callback(true, cachedHistory && cachedListings);
        });
    });
}

// Initialize the inventory UI.
function initializeInventoryUI() {
    const isOwnInventory = steamPage.activeUser().strSteamId == steamPage.steamId();
    let previousSelection = -1; // To store the index of the previous selection.
    updateInventoryUI(isOwnInventory);

    $('.games_list_tabs').on('click', '*', () => {
        updateInventoryUI(isOwnInventory);
    });

    // Ignore selection on other user's inventories.
    if (!isOwnInventory) {
        return;
    }

    // Steam adds 'display:none' to items while searching. These should not be selected while using shift/ctrl.
    const filter = '.itemHolder:not([style*=none])';
    $('#inventories').selectable({
        filter: filter,
        selecting: function (e, ui) {
            // Get selected item index.
            const selectedIndex = $(ui.selecting.tagName, e.target).index(ui.selecting);

            // If shift key was pressed and there is previous - select them all.
            if (e.shiftKey && previousSelection > -1) {
                $(ui.selecting.tagName, e.target)
                    .slice(
                        Math.min(previousSelection, selectedIndex),
                        1 + Math.max(previousSelection, selectedIndex),
                    )
                    .each(function () {
                        if ($(this).is(filter)) {
                            $(this).addClass('ui-selected');
                        }
                    });
                previousSelection = -1; // Reset previous.
            } else {
                previousSelection = selectedIndex; // Save previous.
            }
        },
        selected: function () {
            updateButtons();
        },
    });

    // Not torn down: initializeInventoryUI runs exactly once, on page load. The
    // teardown exists for whoever calls this a second time - a test, or a future
    // SPA-style re-init - to undo it rather than stack another wrapper on top.
    steamPage.onInventorySelectItem((rgItem) => {
        updateButtons();

        // rgItem comes straight from Steam, not from readInventoryItems, so it is
        // flattened here rather than assumed to already be - readInventoryItems no
        // longer mutates Steam's own objects, so this used to be the one path that
        // quietly depended on some earlier, unrelated call having done so already.
        updateInventorySelection(flattenItem(rgItem, rgItem.assetid || rgItem.id));
    });
}

// Gets the selected items in the inventory.
function getSelectedItems() {
    const ids: string[] = [];
    $('.inventory_ctn').each(function () {
        $(this)
            .find('.inventory_page')
            .each(function () {
                const inventory_page = this;

                $(inventory_page)
                    .find('.itemHolder.ui-selected:not([style*=none])')
                    .each(function () {
                        $(this)
                            .find('.item')
                            .each(function () {
                                const matches = this.id.match(/_(-?\d+)$/);
                                if (matches) {
                                    ids.push(matches[1]);
                                }
                            });
                    });
            });
    });

    return ids;
}

// Gets the selected and marketable items in the inventory.
function getInventorySelectedMarketableItems(callback) {
    const ids = getSelectedItems();

    loadAllInventories().then(() => {
        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                filteredItems.push(item);
            }
        });

        callback(filteredItems);
    });
}

// Gets the selected and gemmable items in the inventory.
function getInventorySelectedGemsItems(callback) {
    const ids = getSelectedItems();

    loadAllInventories().then(() => {
        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            let canTurnIntoGems = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('GetGooValue')
                ) {
                    canTurnIntoGems = true;
                }
            }

            if (!canTurnIntoGems) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                filteredItems.push(item);
            }
        });

        callback(filteredItems);
    });
}

// Gets the selected and booster pack items in the inventory.
function getInventorySelectedBoosterPackItems(callback) {
    const ids = getSelectedItems();

    loadAllInventories().then(() => {
        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            let canOpenBooster = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('OpenBooster')
                ) {
                    canOpenBooster = true;
                }
            }

            if (!canOpenBooster) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                filteredItems.push(item);
            }
        });

        callback(filteredItems);
    });
}

// Updates the (selected) sell ... items button.
function updateSellSelectedButton() {
    getInventorySelectedMarketableItems((items) => {
        const selectedItems = items.length;
        if (items.length == 0) {
            $('.sell_selected').hide();
            $('.sell_manual').hide();
        } else {
            $('.sell_selected').show();
            if (canSellSelectedItemsManually(items)) {
                $('.sell_manual').show();
                $('.sell_manual > span').text(
                    `Sell ${selectedItems}${selectedItems == 1 ? ' Item Manual' : ' Items Manual'}`,
                );
            } else {
                $('.sell_manual').hide();
            }
            $('.sell_selected > span').text(
                `Sell ${selectedItems}${selectedItems == 1 ? ' Item' : ' Items'}`,
            );
        }
    });
}

// Updates the (selected) turn into ... gems button.
function updateTurnIntoGemsButton() {
    getInventorySelectedGemsItems((items) => {
        const selectedItems = items.length;
        if (items.length == 0) {
            $('.turn_into_gems').hide();
        } else {
            $('.turn_into_gems').show();
            $('.turn_into_gems > span').text(
                `Turn ${selectedItems}${selectedItems == 1 ? ' Item Into Gems' : ' Items Into Gems'}`,
            );
        }
    });
}

// Updates the (selected) open ... booster packs button.
function updateOpenBoosterPacksButton() {
    getInventorySelectedBoosterPackItems((items) => {
        const selectedItems = items.length;
        if (items.length == 0) {
            $('.unpack_selected_booster_packs').hide();
        } else {
            $('.unpack_selected_booster_packs').show();
            $('.unpack_selected_booster_packs > span').text(
                `Unpack ${selectedItems}${selectedItems == 1 ? ' Booster Pack' : ' Booster Packs'}`,
            );
        }
    });
}

function updateButtons() {
    updateSellSelectedButton();
    updateTurnIntoGemsButton();
    updateOpenBoosterPacksButton();
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateInventorySelection(selectedItem) {
    if (getSettingWithDefault(SETTING_QUICK_SELL_BUTTONS) != 1) {
        return;
    }

    const item_info = $(`#iteminfo${steamPage.activeSelectView()}`);

    if (!item_info.length) {
        return;
    }

    if (item_info.html().indexOf('checkout/sendgift/') > -1) {
        // Gifts have no market information.
        return;
    }

    let timeDelayed = 0;

    // Wait until item_info is loaded.
    while (
        timeDelayed < 2500 &&
        item_info.find('a[href^="https://steamcommunity.com/market/listings/"]').length == 0
    ) {
        await delay(100);
        timeDelayed += 100;
    }

    const market_hash_name = getMarketHashName(selectedItem);
    if (market_hash_name == null) {
        return;
    }

    const appid = selectedItem.appid;
    const item = {
        appid: parseInt(appid),
        description: {
            market_hash_name: market_hash_name,
        },
    };

    const isBoosterPack = selectedItem.name.toLowerCase().endsWith('booster pack');
    if (isBoosterPack) {
        const tradingCardsUrl = `/market/search?q=&category_753_Game%5B%5D=tag_app_${selectedItem.market_fee_app}&category_753_item_class%5B%5D=tag_item_class_2&appid=753`;
        const communityHeader = $('h1', item_info).next().find('span').eq(0);
        communityHeader.replaceWith(
            `<a href="${tradingCardsUrl}"><span>${communityHeader.text()}</span></a>`,
        );
    }

    // Skip unmarketable items
    if (!selectedItem.marketable) {
        return;
    }

    // Ignored queued items.
    if (isItemQueued(selectedItem)) {
        return;
    }

    const marketLink = `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(market_hash_name)}`;
    const baseLink = $(`a[href^="${marketLink}"]`, item_info);
    const ownerActions = baseLink.parent().parent();

    market.getOrderBook(item, false, (err, orderbook) => {
        if (err) {
            logConsole(
                `Failed to get order book for ${selectedItem.name || selectedItem.description.name}`,
            );
            return;
        }

        // Ignored queued items.
        if (isItemQueued(selectedItem)) {
            return;
        }

        const sellRows = (orderbook.sell_order_graph || [])
            .slice(0, 10)
            .map(
                ([price, qty]) =>
                    `<tr><td align="right">${formatPrice(Math.round(price * 100))}</td><td align="right">${qty}</td></tr>`,
            )
            .join('');

        const buyRows = (orderbook.buy_order_graph || [])
            .slice(0, 10)
            .map(
                ([price, qty]) =>
                    `<tr><td align="right">${formatPrice(Math.round(price * 100))}</td><td align="right">${qty}</td></tr>`,
            )
            .join('');

        const groupMain = $(`<div id="listings_group">
                <div>
                    <div id="listings_sell">Sell</div>
                    <table class="market_commodity_orders_table"><tr><th align="right">Price</th><th align="right">Quantity</th></tr>${sellRows}</table>
                </div>
                <div>
                    <div id="listings_buy">Buy</div>
                    <table class="market_commodity_orders_table"><tr><th align="right">Price</th><th align="right">Quantity</th></tr>${buyRows}</table>
                </div>
            </div>`);

        baseLink.next().append(groupMain);

        // Generate quick sell buttons.
        let prices: number[] = [];

        if (orderbook != null && orderbook.highest_buy_order != null) {
            prices.push(parseInt(orderbook.highest_buy_order));
        }

        if (orderbook != null && orderbook.lowest_sell_order != null) {
            // Transaction volume must be separable into three or more parts (no matter if equal): valve+publisher+seller.
            if (parseInt(orderbook.lowest_sell_order) > 3) {
                prices.push(parseInt(orderbook.lowest_sell_order) - 1);
            }
            prices.push(parseInt(orderbook.lowest_sell_order));
        }

        prices = prices.filter((v, i) => prices.indexOf(v) === i).sort((a, b) => a - b);

        let buttons = '<div id="price_buttons">';
        prices.forEach((e) => {
            buttons += `<a class="item_market_action_button item_market_action_button_green quick_sell" id="quick_sell${e}">
                    <span class="item_market_action_button_edge item_market_action_button_left"></span>
                    <span class="item_market_action_button_contents">${formatPrice(e)}</span>
                    <span class="item_market_action_button_edge item_market_action_button_right"></span>
                    <span class="item_market_action_button_preload"></span>
                </a>`;
        });
        buttons += '</div>';

        ownerActions.append(buttons);

        ownerActions.append(`<div id="sell_button" style="display:flex">
                <input id="quick_sell_input" style="background-color: black;color: white;border: transparent;max-width:65px;text-align:center;" type="number" value="${((orderbook.lowest_sell_order || 0) / 100).toFixed(2)}" step="0.01" />&nbsp;
                <a class="item_market_action_button item_market_action_button_green quick_sell_custom">
                    <span class="item_market_action_button_edge item_market_action_button_left"></span>
                    <span class="item_market_action_button_contents">➜ Sell</span>
                    <span class="item_market_action_button_edge item_market_action_button_right"></span>
                    <span class="item_market_action_button_preload"></span>
                </a>
            </div>`);

        $('.quick_sell').on('click', function () {
            let price = $(this).attr('id').replace('quick_sell', '');
            price = market.getPriceBeforeFees(price);

            totalNumberOfQueuedItems++;

            sellQueue.push({
                item: selectedItem,
                sellPrice: price,
            });
        });

        $('.quick_sell_custom').on('click', () => {
            let price = $('#quick_sell_input', ownerActions).val() * 100;
            price = market.getPriceBeforeFees(price);

            totalNumberOfQueuedItems++;

            sellQueue.push({
                item: selectedItem,
                sellPrice: price,
            });
        });
    });
}

// Update the inventory UI.
function updateInventoryUI(isOwnInventory) {
    // Remove previous containers (e.g., when a user changes inventory).
    $('#inventory_sell_buttons').remove();
    $('#see_settings_modal').remove();
    $('#inventory_reload_button').remove();

    $('#see_settings').remove();
    $('#global_action_menu').prepend(
        '<span id="see_settings"><a href="javascript:void(0)">⬖ Steam Economy Enhancer</a></span>',
    );
    $('#see_settings').on('click', '*', () => openSettings());

    const appId = getActiveInventory().m_appid;
    const showMiscOptions = appId == 753;
    const TF2 = appId == 440;

    let buttonsHtml = `
        <a class="btn_green_white_innerfade btn_medium_wide sell_all"><span>Sell All Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_all_duplicates"><span>Sell All Duplicate Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_selected" style="display:none"><span>Sell Selected Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_manual" style="display:none"><span>Sell Manually</span></a>
    `;

    if (showMiscOptions) {
        buttonsHtml += `
            <a class="btn_green_white_innerfade btn_medium_wide sell_all_cards"><span>Sell All Cards</span></a>
            <div class="see_inventory_buttons">
                <a class="btn_darkblue_white_innerfade btn_medium_wide turn_into_gems" style="display:none"><span>Turn Selected Items Into Gems</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide unpack_all_booster_packs"><span>Unpack All Booster Packs</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide unpack_selected_booster_packs" style="display:none"><span>Unpack Selected Booster Packs</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide gem_all_duplicates"><span>Turn All Duplicate Items Into Gems</span></a>
            </div>
        `;
    } else if (TF2) {
        buttonsHtml +=
            '<a class="btn_green_white_innerfade btn_medium_wide sell_all_crates"><span>Sell All Crates</span></a>';
    }

    const sellButtons = $(
        `<div id="inventory_sell_buttons" class="see_inventory_buttons">${buttonsHtml}</div>`,
    );

    const reloadButton = $(
        '<a id="inventory_reload_button" class="btn_darkblue_white_innerfade btn_medium_wide reload_inventory" style="margin-right:12px"><span>Reload Inventory</span></a>',
    );

    const logo = $('#inventory_logos')[0];
    logo.style.height = 'auto';
    logo.style.maxHeight = 'unset';

    $('#inventory_applogo').hide(); // Hide the Steam/game logo, we don't need to see it twice.
    $('#inventory_applogo').after(logger);

    $('#logger').on('scroll', () => {
        const hasUserScrolledToBottom =
            $('#logger').prop('scrollHeight') - $('#logger').prop('clientHeight') <=
            $('#logger').prop('scrollTop') + 1;
        setUserScrolled(!hasUserScrolledToBottom);
    });

    // Only add buttons on the user's inventory.
    if (isOwnInventory) {
        $('#inventory_applogo').after(sellButtons);

        // Add bindings to sell buttons.
        $('.sell_all').on('click', '*', () => {
            sellAllItems();
        });
        $('.sell_selected').on('click', '*', sellSelectedItems);
        $('.sell_all_duplicates').on('click', '*', sellAllDuplicateItems);
        $('.gem_all_duplicates').on('click', '*', gemAllDuplicateItems);
        $('.sell_manual').on('click', '*', sellSelectedItemsManually);
        $('.sell_all_cards').on('click', '*', sellAllCards);
        $('.sell_all_crates').on('click', '*', sellAllCrates);
        $('.turn_into_gems').on('click', '*', turnSelectedItemsIntoGems);
        $('.unpack_all_booster_packs').on('click', '*', unpackAllBoosterPacks);
        $('.unpack_selected_booster_packs').on('click', '*', unpackSelectedBoosterPacks);
    }

    $('.inventory_rightnav').prepend(reloadButton);
    $('.reload_inventory').on('click', '*', () => {
        window.location.reload();
    });

    loadAllInventories().then(() => {
        const updateInventoryPrices = function () {
            if (getSettingWithDefault(SETTING_INVENTORY_PRICE_LABELS) == 1) {
                setInventoryPrices(getInventoryItems());
            }
        };

        // Load after the inventory is loaded.
        updateInventoryPrices();

        $('#pagecontrol_cur').observe('childlist', () => {
            updateInventoryPrices();
        });
    });
}

// Loads all inventories.
async function loadAllInventories() {
    const main = getActiveInventory();

    const childs = Object.values(main.m_rgChildInventories);

    for (const inventory of [...childs, main]) {
        await new Promise((resolve) => inventory.LoadCompleteInventory().done(resolve));
    }
}

// Gets the inventory items from the active inventory.
function getInventoryItems() {
    return readInventoryItems(getActiveInventory(), 'm_rgChildInventories', 'm_rgAssets');
}
//#endregion

//#region Inventory + Tradeoffer
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_INVENTORY || currentPage == PAGE_TRADEOFFER

// Gets the active inventory.
function getActiveInventory() {
    return steamPage.activeInventory();
}

// Sets the prices for the items.
function setInventoryPrices(items) {
    inventoryPriceQueue.kill();

    items.forEach((item) => {
        if (!item.marketable) {
            return;
        }

        if (!$(item.element).is(':visible')) {
            return;
        }

        inventoryPriceQueue.push(item);
    });
}

// Bug fixed here: this queue's worker used to always be called with ignoreErrors
// hardcoded to false, even on the forced retry, so a persistently failing item's
// price label silently never appeared - unlike itemQueue, whose retry actually forces
// past the failure. runQueue passes the item's real ignoreErrors flag, matching
// itemQueue's behaviour.
const inventoryPriceQueue = runQueue(inventoryPriceQueueWorker, { retryOnFailure: true });

function inventoryPriceQueueWorker(item, ignoreErrors, callback) {
    let failed = 0;
    const itemName = item.name || item.description.name;

    // Only get the market orders here, the history is not important to visualize the current prices.
    market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
        if (err) {
            logConsole(`Failed to get order book for ${itemName}`);

            if (err != ERROR_SUCCESS) {
                failed += 1;
            }
        }

        if (failed > 0 && !ignoreErrors) {
            return callback(false, cachedListings);
        }

        const sellPrice = calculateSellPriceBeforeFees(
            null,
            orderbook,
            false,
            0,
            NO_LISTING_PRICE_SENTINEL,
            createPricingRules(),
        );

        // Nobody is selling this one, so there is no price to show and nothing to
        // add to a trade offer total.
        const priceWithFees =
            sellPrice == NO_LISTING_PRICE_SENTINEL ? 0 : market.getPriceIncludingFees(sellPrice);
        const itemPrice = sellPrice == NO_LISTING_PRICE_SENTINEL ? '∞' : formatPrice(priceWithFees);

        listingState.set(getAssetKey(item), { sellPrice: priceWithFees });

        const elementName = `${currentPage == PAGE_TRADEOFFER ? '#item' : '#'}${getAssetKey(item)}`;
        const element = $(elementName);

        $('.inventory_item_price', element).remove();
        element.append(`<span class="inventory_item_price">${itemPrice}</span>`);

        return callback(true, cachedListings);
    });
}
//#endregion

//#region Market
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_MARKET || currentPage == PAGE_MARKET_LISTING
const marketListingsRelistedAssets: any[] = [];
let marketProgressBar: any;

// Progress of the current relist run, shown on the relist overpriced button.
// Both are reset once nothing is queueing relists any more, see resetMarketRelistProgress.
let marketRelistTotal = 0;
let marketRelistDone = 0;

// Listings already queued for relisting. Relisting one twice is pointless work: the
// second attempt looks up a listing that the first one already removed. This replaces
// disabling the buttons for the duration of the run, which also blocked relisting a
// hand-picked selection while automatic relisting was working through another one.
const marketRelistQueuedListings = new Set();

function increaseMarketProgressMax() {
    let value = marketProgressBar.max;

    // Reset the progress bar if it already completed
    if (marketProgressBar.value === value) {
        marketProgressBar.value = 0;
        value = 0;
    }

    marketProgressBar.max = value + 1;
    marketProgressBar.removeAttribute('hidden');
}

// Refreshing the buttons walks every listing of every list, so calling it once per
// listing makes a pass over N listings cost N squared. Listings answered from the cache
// are processed with no delay between them, which turns a full page of them into one
// burst, so coalesce whatever arrives before the next frame into a single refresh.
let marketOverpricedButtonsQueued = false;

function refreshMarketOverpricedButtons() {
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

function increaseMarketProgress() {
    marketProgressBar.value += 1;

    if (marketProgressBar.value === marketProgressBar.max) {
        marketProgressBar.setAttribute('hidden', 'true');
    }

    // A listing was just priced, relisted or removed, so the overpriced count may have changed.
    refreshMarketOverpricedButtons();
}

// Match number part from any currency format
const getPriceValueAsInt = (listing) =>
    steamPage.parsePriceText(listing.match(/(?<price>[0-9][0-9 .,]*)/)?.groups?.price ?? 0);

const marketListingsQueue = async.queue((listing: QueueTask, next) => {
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

function marketListingsQueueWorker(listing, ignoreErrors, callback) {
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

            listingState.set(listing.listingid, {
                sellPrice: sellPriceWithOffset,
                verdict: verdict,
            });

            // The verdict is still a class. It styles the listing and it is
            // what the selection buttons match on. The price is not: nothing
            // can style `price_1234` and nothing reads it back any more.
            listingUI.addClass(verdict);

            $('.market_listing_my_price', listingUI)
                .last()
                .prop('title', `The best price is ${formatPrice(sellPriceWithoutOffsetWithFees)}.`);

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

const marketOverpricedQueue = async.queue((item: QueueTask, next) => {
    marketOverpricedQueueWorker(item, false, (success) => {
        const callback = () => {
            marketRelistDone += 1;

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

// The relist run is over, put the buttons back to showing the (now lower) overpriced count.
function resetMarketRelistProgress() {
    marketRelistTotal = 0;
    marketRelistDone = 0;
    marketRelistQueuedListings.clear();

    refreshMarketOverpricedButtons();
}

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

function marketOverpricedQueueWorker(item, ignoreErrors, callback) {
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
function queueOverpricedItemListing(listingid) {
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
        marketRelistTotal += 1;

        increaseMarketProgressMax();
        refreshMarketOverpricedButtons();
    }
}

const marketRemoveQueue = async.queue((listingid: QueueTask, next) => {
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

function marketRemoveQueueWorker(listingid, ignoreErrors, callback) {
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

const marketListingsItemsQueue = async.queue((listing: QueueTask, next) => {
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

marketListingsItemsQueue.drain(() => {
    const myMarketListings = $('#tabContentsMyActiveMarketListingsRows');
    myMarketListings.checkboxes('range', true);

    // Sometimes the Steam API is returning duplicate entries (especially during item listing), filter these.
    const seen = {};
    $('.market_listing_row', myMarketListings).each(function () {
        const item_id = $(this).attr('id');
        if (seen[item_id]) {
            $(this).remove();
        } else {
            seen[item_id] = true;
        }

        // Remove listings awaiting confirmations, they are already listed separately.
        if (
            $('.item_market_action_button', this)
                .attr('href')
                .toLowerCase()
                .includes('CancelMarketListingConfirmation'.toLowerCase())
        ) {
            $(this).remove();
        }

        // Remove buy order listings, they are already listed separately.
        if (
            $('.item_market_action_button', this)
                .attr('href')
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

function fillMarketListingsQueue() {
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

                totalSellOrderAmount += assetInfo.amount;

                if (!isNaN(assetInfo.priceBuyer)) {
                    totalSellOrderPriceBuyer += assetInfo.priceBuyer * assetInfo.amount;
                }
                if (!isNaN(assetInfo.priceSeller)) {
                    totalSellOrderPriceSeller += assetInfo.priceSeller * assetInfo.amount;
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

// Gets the asset info (appid/contextid/assetid) based on a listingid.
function getAssetInfoFromListingId(listingid) {
    const listing = getListingFromLists(listingid);
    if (listing == null) {
        return {};
    }

    const actionButton = $('.item_market_action_button', listing.elm).attr('href');
    // Market buy orders have no asset info.
    if (actionButton == null || actionButton.toLowerCase().includes('cancelmarketbuyorder')) {
        return {};
    }

    const priceBuyer = getPriceValueAsInt(
        $('.market_listing_price > span:nth-child(1) > span:nth-child(1)', listing.elm).text(),
    );
    const priceSeller = getPriceValueAsInt(
        $('.market_listing_price > span:nth-child(1) > span:nth-child(3)', listing.elm).text(),
    );
    const itemIds = actionButton.split(',');
    const appid = replaceNonNumbers(itemIds[2]);
    const contextid = replaceNonNumbers(itemIds[3]);
    const assetid = replaceNonNumbers(itemIds[4]);
    const amount = Number(steamPage.assetFor(appid, contextid, assetid)?.amount ?? 1);
    return {
        appid,
        contextid,
        assetid,
        amount,
        priceBuyer,
        priceSeller,
    };
}

function getAssetInfoFromBuyOrderId(orderid) {
    const listing = getListingFromLists(orderid);

    if (listing == null) {
        return {};
    }

    if (!listing.elm.id.startsWith('mbuyorder_') && !listing.elm.id.startsWith('mybuyorder_')) {
        return {};
    }

    const amount = parseInt($('.market_listing_buyorder_qty', listing.elm).text().trim());
    const price = getPriceValueAsInt($('.market_listing_price', listing.elm)[0].innerText);

    return { amount, price };
}

// Adds market item listings.
function addMarketListings(market_listing_see) {
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
function addMarketCheckboxes() {
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
function processMarketListings() {
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
                .attr('id')
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

// Update the select/deselect all button on the market.
function updateMarketSelectAllButton() {
    $('.market_listing_buttons').each(function () {
        const selectionGroup = $(this).parent().parent();
        let invert =
            $('.market_select_item:checked', selectionGroup).length ==
            $('.market_select_item', selectionGroup).length;
        if ($('.market_select_item', selectionGroup).length == 0) {
            // If there are no items to select, keep it at Select all.
            invert = false;
        }
        $('.select_all > span', selectionGroup).text(invert ? 'Deselect all' : 'Select all');
    });
}

// Shows the number of overpriced listings on the overpriced buttons.
// The count is taken from the matching items so it reflects exactly what the buttons act on,
// which means it follows the search filter.
//
// While a relist run is in progress the relist overpriced button shows the progress of the
// shared relist queue instead of the count, and is marked busy because everything it would
// queue is already queued. Relist selected is left alone: it acts on a hand-picked
// selection, which is not what a run started somewhere else is working through.
function updateMarketOverpricedButtons() {
    const isRelisting = marketRelistTotal > 0;

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
                ? `Relisting ${marketRelistDone}/${marketRelistTotal}`
                : `Relist overpriced (${count})`,
        );

        $('.relist_overpriced', selectionGroup).toggleClass('see_button_busy', isRelisting);

        $('.select_overpriced > span', selectionGroup).text(`Select overpriced (${count})`);
    });
}

// Sort the market listings.
function sortMarketListings(elem, isPrice, isDateOrQuantity, isName) {
    const list = getListFromContainer(elem);
    if (list == null) {
        logConsole('Invalid parameter, could not find a list matching elem.');
        return;
    }

    // Change sort order (asc/desc).
    let asc = true;

    // (Re)set the asc/desc arrows.
    const arrow_down = '▼';
    const arrow_up = '▲';

    $('.market_listing_table_header > span', elem).each(function () {
        if ($(this).hasClass('market_listing_edit_buttons')) {
            return;
        }

        if ($(this).text().includes(arrow_up)) {
            asc = false;
        }

        $(this).text($(this).text().replace(` ${arrow_down}`, '').replace(` ${arrow_up}`, ''));
    });

    let market_listing_selector;
    if (isPrice) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(1);
    } else if (isDateOrQuantity) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(2);
    } else if (isName) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(3);
    }
    market_listing_selector.text(
        `${market_listing_selector.text()} ${asc ? arrow_up : arrow_down}`,
    );

    if (list.sort == null) {
        return;
    }

    const isBuyOrder = list.list.querySelectorAll('.market_listing_buyorder_qty').length >= 1;

    if (isName) {
        list.sort('', {
            order: asc ? 'asc' : 'desc',
            sortFunction: function (a, b) {
                if (
                    a
                        .values()
                        .market_listing_game_name.toLowerCase()
                        .localeCompare(b.values().market_listing_game_name.toLowerCase()) == 0
                ) {
                    return a
                        .values()
                        .market_listing_item_name_link.toLowerCase()
                        .localeCompare(b.values().market_listing_item_name_link.toLowerCase());
                }
                return a
                    .values()
                    .market_listing_game_name.toLowerCase()
                    .localeCompare(b.values().market_listing_game_name.toLowerCase());
            },
        });
    } else if (isDateOrQuantity) {
        const currentMonth = luxon.DateTime.local().month;

        if (isBuyOrder) {
            list.sort('market_listing_buyorder_qty', {
                order: asc ? 'asc' : 'desc',
                sortFunction: function (a, b) {
                    const quantityA = a.elm.querySelector('.market_listing_buyorder_qty').innerText;
                    const quantityB = b.elm.querySelector('.market_listing_buyorder_qty').innerText;

                    return quantityA - quantityB;
                },
            });
        } else {
            list.sort('market_listing_listed_date', {
                order: asc ? 'asc' : 'desc',
                sortFunction: function (a, b) {
                    let firstDate = luxon.DateTime.fromString(
                        a.values().market_listing_listed_date.trim(),
                        'd MMM',
                    );
                    let secondDate = luxon.DateTime.fromString(
                        b.values().market_listing_listed_date.trim(),
                        'd MMM',
                    );

                    if (firstDate == null || secondDate == null) {
                        return 0;
                    }

                    if (firstDate.month > currentMonth) {
                        firstDate = firstDate.plus({ years: -1 });
                    }
                    if (secondDate.month > currentMonth) {
                        secondDate = secondDate.plus({ years: -1 });
                    }

                    if (firstDate > secondDate) {
                        return 1;
                    }
                    if (firstDate === secondDate) {
                        return 0;
                    }
                    return -1;
                },
            });
        }
    } else if (isPrice) {
        list.sort('market_listing_price', {
            order: asc ? 'asc' : 'desc',
            sortFunction: function (a, b) {
                if (!isBuyOrder) {
                    let listingPriceA = $(a.values().market_listing_price).text();
                    listingPriceA = listingPriceA.substr(0, listingPriceA.indexOf('('));

                    let listingPriceB = $(b.values().market_listing_price).text();
                    listingPriceB = listingPriceB.substr(0, listingPriceB.indexOf('('));

                    const firstPrice = getPriceValueAsInt(listingPriceA);
                    const secondPrice = getPriceValueAsInt(listingPriceB);

                    return firstPrice - secondPrice;
                } else {
                    const priceA = getPriceValueAsInt(
                        a.elm.querySelector(
                            'div:nth-child(3) > span:nth-child(1) > span:nth-child(1)',
                        ).innerText,
                    );
                    const priceB = getPriceValueAsInt(
                        b.elm.querySelector(
                            'div:nth-child(3) > span:nth-child(1) > span:nth-child(1)',
                        ).innerText,
                    );

                    return priceA - priceB;
                }
            },
        });
    }
}

function getListFromContainer(group) {
    for (let i = 0; i < marketLists.length; i++) {
        if (group[0].contains(marketLists[i].listContainer)) {
            return marketLists[i];
        }
    }
}

function getListingFromLists(listingid) {
    // Sometimes listing ids are contained in multiple lists (?), use the last one available as this is the one we're most likely interested in.
    for (let i = marketLists.length - 1; i >= 0; i--) {
        let values = marketLists[i].get('market_listing_item_name', `mylisting_${listingid}_name`);
        if (values != null && values.length > 0) {
            return values[0];
        }

        values = marketLists[i].get('market_listing_item_name', `mbuyorder_${listingid}_name`);
        if (values != null && values.length > 0) {
            return values[0];
        }
    }
}

function removeListingFromLists(listingid) {
    for (let i = 0; i < marketLists.length; i++) {
        marketLists[i].remove('market_listing_item_name', `mylisting_${listingid}_name`);
        marketLists[i].remove('market_listing_item_name', `mbuyorder_${listingid}_name`);
    }

    // Listings are removed from the lists a few seconds after they are relisted or removed,
    // which can be after the queue drained, so refresh the counts here as well.
    refreshMarketOverpricedButtons();
}

// Initialize the market UI.
function initializeMarketUI() {
    $('.market_header_text').append('<progress id="see_market_progress" value="1" max="1" hidden>');
    marketProgressBar = document.getElementById('see_market_progress');

    // Sell orders.
    // Steam prepends a "listings awaiting confirmation" block whenever a confirmation is pending,
    // so the sell listings are not always the first header. steamPage.sellListingsHeader()
    // anchors to the sell listings table itself and falls back to the first header only if
    // that table cannot be found - see pickSellListingsHeader for why the fallback matters.
    const sellListingsHeader = steamPage.sellListingsHeader();

    sellListingsHeader.append(`<div class="market_listing_buttons">
        <a class="item_market_action_button item_market_action_button_green select_all market_listing_button">
            <span class="item_market_action_button_contents">Select all</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_five_from_page market_listing_button">
            <span class="item_market_action_button_contents">Select 5</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_twentyfive_from_page market_listing_button">
            <span class="item_market_action_button_contents">Select 25</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green remove_selected market_listing_button">
            <span class="item_market_action_button_contents">Remove selected</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green relist_selected market_listing_button" style="margin-left:auto">
            <span class="item_market_action_button_contents">Relist selected</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green relist_overpriced market_listing_button">
            <span class="item_market_action_button_contents">Relist overpriced (0)</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_overpriced market_listing_button">
            <span class="item_market_action_button_contents">Select overpriced (0)</span>
        </a>
    </div>`);

    // Listings confirmations and buy orders.
    $('.my_market_header').not(sellListingsHeader).append(`<div class="market_listing_buttons">
        <a class="item_market_action_button item_market_action_button_green select_all market_listing_button">
            <span class="item_market_action_button_contents">Select all</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green remove_selected market_listing_button">
            <span class="item_market_action_button_contents">Remove selected</span>
        </a>
    </div>`);

    $('.market_listing_table_header').on('click', 'span', function () {
        if (
            $(this).hasClass('market_listing_edit_buttons') ||
            $(this).hasClass('item_market_action_button_contents')
        ) {
            return;
        }

        const isPrice =
            $('.market_listing_table_header', $(this).parent().parent()).children().eq(1).text() ==
            $(this).text();
        const isDate =
            $('.market_listing_table_header', $(this).parent().parent()).children().eq(2).text() ==
            $(this).text();
        const isName =
            $('.market_listing_table_header', $(this).parent().parent()).children().eq(3).text() ==
            $(this).text();

        sortMarketListings($(this).parent().parent(), isPrice, isDate, isName);
    });

    $('.select_all').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        const invert =
            $('.market_select_item:checked', selectionGroup).length ==
            $('.market_select_item', selectionGroup).length;

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', !invert);
        }

        updateMarketSelectAllButton();
    });

    $('.select_five_from_page').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        let count = 0;
        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if (count == 5) {
                break;
            }
            if (!$('.market_select_item', marketList.matchingItems[i].elm).prop('checked')) {
                $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', true);
                count += 1;
            }
        }

        updateMarketSelectAllButton();
    });

    $('.select_twentyfive_from_page').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        let count = 0;
        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if (count == 25) {
                break;
            }
            if (!$('.market_select_item', marketList.matchingItems[i].elm).prop('checked')) {
                $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', true);
                count += 1;
            }
        }

        updateMarketSelectAllButton();
    });

    $('.select_overpriced').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if ($(marketList.matchingItems[i].elm).hasClass(VERDICT_OVERPRICED)) {
                $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', true);
            }
        }

        $('.market_listing_row', selectionGroup).each(function () {
            if ($(this).hasClass(VERDICT_OVERPRICED)) {
                $('.market_select_item', $(this)).prop('checked', true);
            }
        });

        updateMarketSelectAllButton();
    });

    $('.remove_selected').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if ($('.market_select_item', $(marketList.matchingItems[i].elm)).prop('checked')) {
                const listingid = replaceNonNumbers(
                    marketList.matchingItems[i].values().market_listing_item_name,
                );

                const listingUI = $(getListingFromLists(listingid).elm);
                listingUI.addClass('removing');

                marketRemoveQueue.push(listingid);
                increaseMarketProgressMax();
            }
        }
    });

    $('.market_relist_auto').change(() => {
        setSetting(SETTING_RELIST_AUTOMATICALLY, $('.market_relist_auto').is(':checked') ? 1 : 0);
    });

    $('.relist_overpriced').on('click', '*', function () {
        if ($(this).closest('.relist_overpriced').hasClass('see_button_busy')) {
            return;
        }

        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if ($(marketList.matchingItems[i].elm).hasClass(VERDICT_OVERPRICED)) {
                const listingid = replaceNonNumbers(
                    marketList.matchingItems[i].values().market_listing_item_name,
                );
                queueOverpricedItemListing(listingid);
            }
        }
    });

    $('.relist_selected').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if (
                $(marketList.matchingItems[i].elm) &&
                $('.market_select_item', $(marketList.matchingItems[i].elm)).prop('checked')
            ) {
                const listingid = replaceNonNumbers(
                    marketList.matchingItems[i].values().market_listing_item_name,
                );
                queueOverpricedItemListing(listingid);
            }
        }
    });

    $('#see_settings').remove();
    $('#global_action_menu').prepend(
        '<span id="see_settings"><a href="javascript:void(0)">⬖ Steam Economy Enhancer</a></span>',
    );
    $('#see_settings').on('click', '*', () => openSettings());

    processMarketListings();
    initializeMarketHistoryUI();
}

// Initialize the market history UI.
function initializeMarketHistoryUI() {
    // Use jquery-observe (already included in SEE) to listen for AJAX DOM updates
    $('#tabContentsMyMarketHistory').observe('childlist subtree', () => {
        const controlsDiv = $('#tabContentsMyMarketHistory_controls');

        // Ensure the controls exist and we haven't already injected our jumper
        if (controlsDiv.length > 0 && $('#see_page_jump').length === 0) {
            const jumpContainer = $('<span id="see_page_jump"></span>');
            const input = $('<input type="number" min="1" placeholder="Page" />');
            const btn = $(
                '<span class="btn_green_white_innerfade btn_small" style="cursor: pointer;"><span>Jump</span></span>',
            );

            jumpContainer.append(input).append(btn);
            controlsDiv.append(jumpContainer);

            btn.on('click', () => {
                const targetPage = parseInt(input.val());
                if (isNaN(targetPage) || targetPage < 1) {
                    return; // Fail silently
                }
                const targetIndex = targetPage - 1;

                steamPage.goToHistoryPage(targetIndex);
            });

            input.on('keypress', (e) => {
                if (e.which === 13) {
                    // Enter key
                    btn.click();
                }
            });
        }
    });
}
//#endregion

//#region Tradeoffers
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_TRADEOFFER
// Gets the trade offer's inventory items from the active inventory.
function getTradeOfferInventoryItems() {
    return readInventoryItems(getActiveInventory(), 'rgChildInventories', 'rgInventory');
}

// side is 'me' or 'them' - see steamPage.tradeAssets/findTradeAsset.
function sumTradeOfferAssets(side) {
    // What the offer holds and what it is worth. The prices come from the state the
    // inventory pass wrote, not from the class names on the item elements.
    const summary = aggregateTradeOfferAssets(steamPage.tradeAssets(side), (asset) => {
        const rgItem = steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid);

        if (rgItem == null) {
            return null;
        }

        const state = listingState.get(getAssetKey(rgItem));

        return {
            name: rgItem.name,
            type: rgItem.type,
            originalAmount: rgItem.original_amount,
            amount: rgItem.amount,
            price: state == null ? 0 : state.sellPrice,
        };
    });

    const sortable = summary.items.map((item) => [item.text, item.count]);

    sortable
        .sort((a, b) => {
            return a[1] - b[1];
        })
        .reverse();

    let totalText = `<strong>Number of unique items: ${sortable.length}, worth ${formatPrice(summary.totalPrice)}<br/><br/></strong>`;
    let totalNumOfItems = 0;
    for (let i = 0; i < sortable.length; i++) {
        totalText += `${sortable[i][1]}x ${sortable[i][0]}<br/>`;
        totalNumOfItems += sortable[i][1];
    }
    totalText += `<br/><strong>Total items: ${totalNumOfItems}</strong><br/>`;

    return totalText;
}

let lastTradeOfferSum = 0;

// Both sides of a trade are walked the same way, by the same two steamPage calls, in
// four different places. TRADE_SIDES is that walk, done once each time instead of once
// per side per place.
const TRADE_SIDES = ['them', 'me'];

function tradeItemsFor(side) {
    return steamPage
        .tradeAssets(side)
        .map((asset) =>
            steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid),
        );
}

function hasLoadedAllTradeOfferItems() {
    return TRADE_SIDES.every((side) => tradeItemsFor(side).every((asset) => asset != null));
}

function initializeTradeOfferUI() {
    if (getSettingWithDefault(SETTING_TRADEOFFER_PRICE_LABELS) == 1) {
        const updateInventoryPrices = function () {
            setInventoryPrices(getTradeOfferInventoryItems());
        };

        const updateInventoryPricesInTrade = function () {
            setInventoryPrices(TRADE_SIDES.flatMap((side) => tradeItemsFor(side)));
        };

        $('.trade_right > div > div > div > .trade_item_box').observe('childlist subtree', () => {
            if (!hasLoadedAllTradeOfferItems()) {
                return;
            }

            const currentTradeOfferSum = TRADE_SIDES.reduce(
                (total, side) => total + steamPage.tradeAssets(side).length,
                0,
            );
            if (lastTradeOfferSum != currentTradeOfferSum) {
                updateInventoryPricesInTrade();
            }

            lastTradeOfferSum = currentTradeOfferSum;

            $('#trade_offer_your_sum').remove();
            $('#trade_offer_their_sum').remove();

            const your_sum = sumTradeOfferAssets('me');
            const their_sum = sumTradeOfferAssets('them');

            $('div.offerheader:nth-child(1) > div:nth-child(3)').append(
                `<div class="trade_offer_sum" id="trade_offer_your_sum">${your_sum}</div>`,
            );
            $('div.offerheader:nth-child(3) > div:nth-child(3)').append(
                `<div class="trade_offer_sum" id="trade_offer_their_sum">${their_sum}</div>`,
            );
        });

        // Load after the inventory is loaded.
        updateInventoryPrices();

        $('#pagecontrol_cur').observe('childlist', () => {
            updateInventoryPrices();
        });
    }

    const appendSelectPageButton = () => {
        $('#inventory_displaycontrols').append(`<div class="trade_offer_buttons">
          <a class="item_market_action_button item_market_action_button_green select_all">
              <span class="item_market_action_button_contents" style="text-transform:none">Select all from page</span>
          </a>
      </div>`);

        $('.select_all').on('click', '*', () => {
            $('.inventory_ctn:visible > .inventory_page:visible > .itemHolder:visible').delayedEach(
                250,
                (i, it) => {
                    const item = it.rgItem;
                    if (item.is_stackable) {
                        return;
                    }

                    if (!item.tradable) {
                        return;
                    }

                    steamPage.moveItemToTrade(it);
                },
            );
        });
    };

    // On counter offers, we need to wait until 'Change offer' is pressed
    if (location.pathname !== '/tradeoffer/new/' && location.pathname !== '/tradeoffer/new') {
        $('.modify_trade_offer').one('click', '*', () => {
            appendSelectPageButton();
        });
    } else {
        appendSelectPageButton();
    }
}
//#endregion

//#region Settings
function openSettings() {
    const price_options = $(`<div id="see_settings_modal">
        <div>
            Calculate prices as the:&nbsp;
            <select id="${SETTING_PRICE_ALGORITHM}">
                <option value="1"${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 1 ? 'selected="selected"' : ''}>Maximum of the average history and lowest sell listing</option>
                <option value="2" ${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 2 ? 'selected="selected"' : ''}>Lowest sell listing</option>
                <option value="3" ${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 3 ? 'selected="selected"' : ''}>Highest current buy order or lowest sell listing</option>
                <option value="4" ${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 4 ? 'selected="selected"' : ''}>Average history only</option>
            </select>
        </div>
        <div style="margin-top:6px;">
            Hours to use for the average history calculated price:&nbsp;
            <input type="number" min="0" step="2" id="${SETTING_PRICE_HISTORY_HOURS}" value=${getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS)}>
        </div>
        <div style="margin-top:6px;">
            The value to add to the calculated price (minimum and maximum are respected):&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_OFFSET}" value=${getSettingWithDefault(SETTING_PRICE_OFFSET)}>
        </div>
        <div style="margin-top:6px">
            Use the second lowest sell listing when the lowest sell listing has a low quantity:&nbsp;
            <input type="checkbox" id="${SETTING_PRICE_IGNORE_LOWEST_Q}" ${getSettingWithDefault(SETTING_PRICE_IGNORE_LOWEST_Q) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px;">
            Don't check market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_CHECK_PRICE}" value=${getSettingWithDefault(SETTING_PRICE_MIN_CHECK_PRICE)}>
        </div>
        <div style="margin-top:6px;">
            Don't list market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_LIST_PRICE}" value=${getSettingWithDefault(SETTING_PRICE_MIN_LIST_PRICE)}>
        </div>
        <div style="margin-top:24px">
            Show price labels in inventory:&nbsp;
            <input type="checkbox" id="${SETTING_INVENTORY_PRICE_LABELS}" ${getSettingWithDefault(SETTING_INVENTORY_PRICE_LABELS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px">
            Show price labels in trade offers:&nbsp;
            <input type="checkbox" id="${SETTING_TRADEOFFER_PRICE_LABELS}" ${getSettingWithDefault(SETTING_TRADEOFFER_PRICE_LABELS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px">
            Show quick sell info and buttons:&nbsp;
            <input type="checkbox" id="${SETTING_QUICK_SELL_BUTTONS}" ${getSettingWithDefault(SETTING_QUICK_SELL_BUTTONS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:24px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_NORMAL_PRICE}" value=${getSettingWithDefault(SETTING_MIN_NORMAL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_NORMAL_PRICE}" value=${getSettingWithDefault(SETTING_MAX_NORMAL_PRICE)}>
            &nbsp;price for normal cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_FOIL_PRICE}" value=${getSettingWithDefault(SETTING_MIN_FOIL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_FOIL_PRICE}" value=${getSettingWithDefault(SETTING_MAX_FOIL_PRICE)}>
            &nbsp;price for foil cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_MISC_PRICE}" value=${getSettingWithDefault(SETTING_MIN_MISC_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_MISC_PRICE}" value=${getSettingWithDefault(SETTING_MAX_MISC_PRICE)}>
            &nbsp;price for other items
        </div>
        <div style="margin-top:6px;">
            Automatically relist overpriced market listings (slow on large inventories):&nbsp;
            <input id="${SETTING_RELIST_AUTOMATICALLY}" class="market_relist_auto" type="checkbox" ${getSettingWithDefault(SETTING_RELIST_AUTOMATICALLY) == 1 ? 'checked' : ''}>
        </div>
    </div>`);

    steamPage.showConfirmDialog('Steam Economy Enhancer', price_options).done(() => {
        setSetting(
            SETTING_MIN_NORMAL_PRICE,
            $(`#${SETTING_MIN_NORMAL_PRICE}`, price_options).val(),
        );
        setSetting(
            SETTING_MAX_NORMAL_PRICE,
            $(`#${SETTING_MAX_NORMAL_PRICE}`, price_options).val(),
        );
        setSetting(SETTING_MIN_FOIL_PRICE, $(`#${SETTING_MIN_FOIL_PRICE}`, price_options).val());
        setSetting(SETTING_MAX_FOIL_PRICE, $(`#${SETTING_MAX_FOIL_PRICE}`, price_options).val());
        setSetting(SETTING_MIN_MISC_PRICE, $(`#${SETTING_MIN_MISC_PRICE}`, price_options).val());
        setSetting(SETTING_MAX_MISC_PRICE, $(`#${SETTING_MAX_MISC_PRICE}`, price_options).val());
        setSetting(SETTING_PRICE_OFFSET, $(`#${SETTING_PRICE_OFFSET}`, price_options).val());
        setSetting(
            SETTING_PRICE_MIN_CHECK_PRICE,
            $(`#${SETTING_PRICE_MIN_CHECK_PRICE}`, price_options).val(),
        );
        setSetting(
            SETTING_PRICE_MIN_LIST_PRICE,
            $(`#${SETTING_PRICE_MIN_LIST_PRICE}`, price_options).val(),
        );
        setSetting(SETTING_PRICE_ALGORITHM, $(`#${SETTING_PRICE_ALGORITHM}`, price_options).val());
        setSetting(
            SETTING_PRICE_IGNORE_LOWEST_Q,
            $(`#${SETTING_PRICE_IGNORE_LOWEST_Q}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_PRICE_HISTORY_HOURS,
            $(`#${SETTING_PRICE_HISTORY_HOURS}`, price_options).val(),
        );
        setSetting(
            SETTING_RELIST_AUTOMATICALLY,
            $(`#${SETTING_RELIST_AUTOMATICALLY}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_INVENTORY_PRICE_LABELS,
            $(`#${SETTING_INVENTORY_PRICE_LABELS}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_TRADEOFFER_PRICE_LABELS,
            $(`#${SETTING_TRADEOFFER_PRICE_LABELS}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_QUICK_SELL_BUTTONS,
            $(`#${SETTING_QUICK_SELL_BUTTONS}`, price_options).prop('checked') ? 1 : 0,
        );

        window.location.reload();
    });
}
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

export { createListingState, getListingVerdict } from './market/listingState.ts';

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

export { getNumberOfDigits, padLeftZero, replaceNonNumbers } from './util/numbers.ts';
//#endregion
