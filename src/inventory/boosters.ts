// Unpacking booster packs.
//
// A booster pack yields three cards. The queue unpacks one pack at a time and reloads the
// inventory afterwards, because the new cards are not in the inventory Steam already sent.

import { ERROR_SUCCESS } from '../constants.ts';
import { isItemQueued, markItemQueued } from '../items/index.ts';
import { runQueue } from '../queue/index.ts';
import { market } from '../steam/market.ts';
import { processed, queued, runTotals } from '../totals.ts';
import { markRow, removeSpinner, renderSpinner } from '../ui/index.ts';
import { logConsole, logDOM } from '../ui/logger.ts';
import { getNumberOfDigits, padLeftZero } from '../util/numbers.ts';
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

        queued(numberOfQueuedItems);

        renderSpinner(`Processing ${numberOfQueuedItems} items`);
    });
}

// Unpacks the selected booster packs.
export function unpackSelectedBoosterPacks() {
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
            queued(numberOfQueuedItems);

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}
