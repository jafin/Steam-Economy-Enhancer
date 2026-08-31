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
import { duplicatesByClassId, getIsCrate, getIsTradingCard } from '../items/index.ts';
import { isRetryMessage } from '../net/request.ts';
import {
    calculateSellPriceBeforeFees,
    createPricingRules,
    formatPrice,
} from '../pricing/algorithms.ts';
import { fetchPricingInputs } from '../pricing/inputs.ts';
import { QueueTask, runQueue } from '../queue/index.ts';
import { SETTING_PRICE_MIN_LIST_PRICE, getSetting } from '../settings/index.ts';
import { steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
import { listed, processed, runTotals, unprocessed } from '../totals.ts';
import { markRow, markRowForSale } from '../ui/index.ts';
import { logConsole, logDOM } from '../ui/logger.ts';
import { getNumberOfDigits, getRandomInt, padLeftZero } from '../util/numbers.ts';
import { enqueueInventoryItems, selectedItemsWhere, withInventory } from './actions.ts';
import { getInventoryItems } from './data.ts';
import { updateTotals } from './progress.ts';
export const sellQueue = async.queue((task: QueueTask, next) => {
    processed();

    const current = runTotals();
    const digits = getNumberOfDigits(current.queuedItems);
    const itemId = task.item.assetid || task.item.id;
    const assetKey = `${task.item.appid}_${task.item.contextid}_${itemId}`;
    const itemName = task.item.name || task.item.description.name;
    const itemNameWithAmount =
        task.item.amount == 1 ? itemName : `${task.item.amount}x ${itemName}`;
    const padLeft = `${padLeftZero(`${current.processedQueueItems}`, digits)} / ${current.queuedItems}`;

    if (
        getSetting(SETTING_PRICE_MIN_LIST_PRICE) * 100 >=
        market.getPriceIncludingFees(task.sellPrice)
    ) {
        logDOM(`${padLeft} - ${itemNameWithAmount} is not listed due to ignoring price settings.`);
        markRow(assetKey, 'notChecked');
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
            markRow(assetKey, 'success');
            markRowForSale(assetKey);

            listed(
                task.sellPrice * task.item.amount,
                market.getPriceIncludingFees(task.sellPrice) * task.item.amount,
            );

            updateTotals();
            callback();

            return;
        }

        if (message && isRetryMessage(message)) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} retrying listing because: ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
            );

            unprocessed();
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
        markRow(assetKey, 'error');

        callback();
    });
}, 1);

export function sellAllItems() {
    withInventory(() => {
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
    withInventory(() => {
        const items = getInventoryItems();
        const marketableItems: any[] = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            marketableItems.push(item);
        });

        const filteredItems = duplicatesByClassId(marketableItems);

        sellItems(filteredItems);
    });
}

export function sellAllCards() {
    withInventory(() => {
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
    withInventory(() => {
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
    selectedItemsWhere((item) => item.marketable).then((items) => {
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
    selectedItemsWhere((item) => item.marketable).then((items) => {
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

    // item.ignoreErrors starts undefined, which reads the same as false to runQueue's
    // retryOnFailure check - no need to initialise it explicitly on a freshly-read item the
    // way there was when items were mutated in place.
    enqueueInventoryItems(itemQueue, items, { spinnerLabel: 'items' });
}

// A cached answer never reached Steam, and its delay is discarded, so it says
// nothing about the connection either way - see nextQueueStep. A failed item gets
// one more try with ignoreErrors forced true before it is dropped.
export const itemQueue = runQueue(itemQueueWorker, { retryOnFailure: true });

export function itemQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;

    fetchPricingInputs(
        item,
        { history: true, name: itemName },
        ({ history, orderbook, failed, cached }) => {
            if (failed > 0 && !ignoreErrors) {
                return callback(false, cached);
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

            return callback(true, cached);
        },
    );
}
