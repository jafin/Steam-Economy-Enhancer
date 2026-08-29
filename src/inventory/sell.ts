// Listing inventory items on the market.
//
// Two queues, because there are two jobs. itemQueue works out what an item should sell for,
// asking Steam for its price history and order book; sellQueue then lists it. Splitting them
// is what lets a run price everything before it starts listing anything.

import async from 'async';
import {
    ERROR_SUCCESS,
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
    RETRY_DELAY_SHORT_MAX,
    RETRY_DELAY_SHORT_MIN,
} from '../constants.ts';
import { getIsCrate, getIsTradingCard, isItemQueued, markItemQueued } from '../items/index.ts';
import { isRetryMessage } from '../net/request.ts';
import {
    calculateSellPriceBeforeFees,
    createPricingRules,
    formatPrice,
} from '../pricing/algorithms.ts';
import { QueueTask, runQueue } from '../queue/index.ts';
import { SETTING_PRICE_MIN_LIST_PRICE, getSetting } from '../settings/index.ts';
import { steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
import { totals } from '../totals.ts';
import { markRow, removeSpinner, renderSpinner } from '../ui/index.ts';
import { logConsole, logDOM } from '../ui/logger.ts';
import { getNumberOfDigits, getRandomInt, padLeftZero } from '../util/numbers.ts';
import { getInventoryItems, loadAllInventories } from './data.ts';
import { updateTotals } from './progress.ts';
import { getInventorySelectedMarketableItems } from './selection.ts';
export const sellQueue = async.queue((task: QueueTask, next) => {
    totals.processedQueueItems++;

    const digits = getNumberOfDigits(totals.queuedItems);
    const itemId = task.item.assetid || task.item.id;
    const itemName = task.item.name || task.item.description.name;
    const itemNameWithAmount =
        task.item.amount == 1 ? itemName : `${task.item.amount}x ${itemName}`;
    const padLeft = `${padLeftZero(`${totals.processedQueueItems}`, digits)} / ${totals.queuedItems}`;

    if (
        getSetting(SETTING_PRICE_MIN_LIST_PRICE) * 100 >=
        market.getPriceIncludingFees(task.sellPrice)
    ) {
        logDOM(`${padLeft} - ${itemNameWithAmount} is not listed due to ignoring price settings.`);
        markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'notChecked');
        next();
        return;
    }

    market.sellItem(task.item, task.sellPrice, (error, data) => {
        // sellItem answers this now. This used to read data.success itself, which was the
        // module's job done in one caller and skipped in the other -- market/relist.ts calls
        // the same method and did not ask, so it read a rejected listing as a sale.
        const success = error === ERROR_SUCCESS;
        const message = data?.message || '';

        const callback = () =>
            setTimeout(() => next(), getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));

        if (success) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} listed for ${formatPrice(market.getPriceIncludingFees(task.sellPrice) * task.item.amount)}, you will receive ${formatPrice(task.sellPrice * task.item.amount)}.`,
            );
            markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'success');

            totals.priceWithoutFeesOnMarket += task.sellPrice * task.item.amount;
            totals.priceWithFeesOnMarket +=
                market.getPriceIncludingFees(task.sellPrice) * task.item.amount;

            updateTotals();
            callback();

            return;
        }

        if (message && isRetryMessage(message)) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} retrying listing because: ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
            );

            totals.processedQueueItems--;
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

export function sellAllItems() {
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

export function sellAllDuplicateItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const marketableItems: any[] = [];
        let filteredItems: any[] = [];

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

export function sellAllCards() {
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

export function sellAllCrates() {
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

export function sellSelectedItems() {
    getInventorySelectedMarketableItems((items) => {
        sellItems(items);
    });
}

export function canSellSelectedItemsManually(items) {
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

export function sellSelectedItemsManually() {
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

export function sellItems(items) {
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
        totals.queuedItems += numberOfQueuedItems;

        renderSpinner(`Processing ${numberOfQueuedItems} items`);
    }
}

// A cached answer never reached Steam, and its delay is discarded, so it says
// nothing about the connection either way - see nextQueueStep. A failed item gets
// one more try with ignoreErrors forced true before it is dropped.
export const itemQueue = runQueue(itemQueueWorker, { retryOnFailure: true });

export function itemQueueWorker(item, ignoreErrors, callback) {
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
                createPricingRules(item),
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
