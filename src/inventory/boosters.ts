// Unpacking booster packs.
//
// A booster pack yields three cards. The queue unpacks one pack at a time and reloads the
// inventory afterwards, because the new cards are not in the inventory Steam already sent.

import { ERROR_SUCCESS } from '../constants.ts';
import { runQueue } from '../queue/index.ts';
import { market } from '../steam/market.ts';
import { processed, runTotals } from '../totals.ts';
import { markRow, removeSpinner, renderSpinner } from '../ui/index.ts';
import { logConsole, logDOM } from '../ui/logger.ts';
import { getNumberOfDigits, padLeftZero } from '../util/numbers.ts';
import { enqueueInventoryItems, hasOwnerAction } from './actions.ts';
import { getInventoryItems, loadAllInventories } from './data.ts';
import { getSelectedItems } from './selection.ts';
export const boosterQueue = runQueue(boosterQueueWorker, { successDelayMs: 250 });

export function boosterQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;
    const itemId = item.assetid || item.id;

    market.unpackBoosterPack(item, (err) => {
        processed();

        const current = runTotals();
        const digits = getNumberOfDigits(current.queuedItems);
        const padLeft = `${padLeftZero(`${current.processedQueueItems}`, digits)} / ${current.queuedItems}`;

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

// Unpacks all booster packs.
export function unpackAllBoosterPacks() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems().filter((item) => hasOwnerAction(item, 'OpenBooster'));

        const numberOfQueuedItems = enqueueInventoryItems(boosterQueue, items, {
            spinnerLabel: 'items',
        });

        if (numberOfQueuedItems === 0) {
            logDOM('No booster packs found in the inventory to unpack.');
        }
    });
}

// Unpacks the selected booster packs.
export function unpackSelectedBoosterPacks() {
    const ids = getSelectedItems();

    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems().filter((item) => {
            const itemId = item.assetid || item.id;

            return ids.indexOf(itemId) !== -1 && hasOwnerAction(item, 'OpenBooster');
        });

        enqueueInventoryItems(boosterQueue, items, { spinnerLabel: 'items' });
    });
}
