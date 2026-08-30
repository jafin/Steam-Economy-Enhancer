// Turning inventory items into gems.
//
// Steam calls this 'grinding into goo'. The queue asks Steam what an item is worth in gems
// before grinding it, so a mispriced item is not destroyed for nothing.

import { hasOwnerAction } from './actions.ts';
import { getInventoryItems, loadAllInventories } from './data.ts';
import { updateTotals } from './progress.ts';
import { getSelectedItems } from './selection.ts';
import { ERROR_SUCCESS } from '../constants.ts';
import { isItemQueued, markItemQueued } from '../items/index.ts';
import { runQueue } from '../queue/index.ts';
import { market } from '../steam/market.ts';
import { processed, queued, runTotals, scrapped } from '../totals.ts';
import { markRow, removeSpinner, renderSpinner } from '../ui/index.ts';
import { logConsole, logDOM } from '../ui/logger.ts';
import { getNumberOfDigits, padLeftZero } from '../util/numbers.ts';

export function gemAllDuplicateItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        let filteredItems: any[] = [];
        let numberOfQueuedItems = 0;

        filteredItems = items.filter(
            (e, i) => items.map((m) => m.classid).indexOf(e.classid) !== i,
        );

        filteredItems.forEach((item) => {
            if (isItemQueued(item)) {
                return;
            }

            if (!hasOwnerAction(item, 'GetGooValue')) {
                return;
            }

            markItemQueued(item);
            scrapQueue.push(item);
            numberOfQueuedItems++;
        });

        if (numberOfQueuedItems > 0) {
            queued(numberOfQueuedItems);

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

export const scrapQueue = runQueue(scrapQueueWorker, { successDelayMs: 250 });

export function scrapQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;
    const itemId = item.assetid || item.id;

    market.getGooValue(item, (err, goo) => {
        processed();

        const current = runTotals();
        const digits = getNumberOfDigits(current.queuedItems);
        const padLeft = `${padLeftZero(`${current.processedQueueItems}`, digits)} / ${current.queuedItems}`;

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

            scrapped(gooValueExpected);
            updateTotals();

            callback(true);
        });
    });
}

// Turns the selected items into gems.
export function turnSelectedItemsIntoGems() {
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

            if (!hasOwnerAction(item, 'GetGooValue')) {
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
            queued(numberOfQueuedItems);

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}
