// The one load-filter-enqueue pipeline nine inventory actions used to repeat by hand.
//
// Each of gems, boosters and sell rendered a spinner, walked the whole inventory, filtered it
// by a capability, skipped items a queue already had, marked and queued the rest, and folded
// the count into the run totals -- six probe sites doing the same `owner_actions` walk, and an
// enqueue tail that drifted between the label a button showed and what its click actually did.
// See .docs/tasks/TASK-03-inventory-action-pipeline.md for the drift this fixes.

import { isItemQueued, markItemQueued } from '../items/index.ts';
import { queued } from '../totals.ts';
import { renderSpinner } from '../ui/index.ts';
import { getInventoryItems, loadAllInventories } from './data.ts';
import { getSelectedItems } from './selection.ts';

// Does Steam offer this owner action on this item? `fragment` is a substring of the action's
// link -- 'GetGooValue' for turning into gems, 'OpenBooster' for unpacking a booster pack.
// `owner_actions` is missing on items Steam has no owner actions for at all, so that reads the
// same as "no match" rather than needing its own guard at every call site.
export function hasOwnerAction(item, fragment: string): boolean {
    if (item.owner_actions == null) {
        return false;
    }

    for (const ownerAction in item.owner_actions) {
        const link = item.owner_actions[ownerAction].link;

        if (link != null && link.includes(fragment)) {
            return true;
        }
    }

    return false;
}

// The selected items matching `predicate`. One loadAllInventories() for the caller, where the
// three getters this replaces each awaited their own -- see updateButtons in
// src/inventory/ui.ts.
export async function selectedItemsWhere(predicate: (item) => boolean): Promise<any[]> {
    const ids = getSelectedItems();

    await loadAllInventories();

    return getInventoryItems().filter((item) => {
        const itemId = item.assetid || item.id;

        return ids.indexOf(itemId) !== -1 && predicate(item);
    });
}

// Marks, counts, pushes and updates the run totals for the items an action is about to work
// through -- the only place that arithmetic exists. Already-queued items are silently skipped,
// same as every action path did before this existed. Returns how many were actually queued, so
// a caller like unpackAllBoosterPacks can still tell "nothing new to do" from "did something".
//
// `spinnerLabel` is the noun the "Processing N ..." spinner reads; every current call site
// passes 'items', matching what all five copies of this tail already rendered.
export function enqueueInventoryItems(
    queue: { push: (item: any) => void },
    items: any[],
    opts: { spinnerLabel: string },
): number {
    let numberOfQueuedItems = 0;

    items.forEach((item) => {
        if (isItemQueued(item)) {
            return;
        }

        markItemQueued(item);
        queue.push(item);
        numberOfQueuedItems++;
    });

    if (numberOfQueuedItems > 0) {
        queued(numberOfQueuedItems);

        renderSpinner(`Processing ${numberOfQueuedItems} ${opts.spinnerLabel}`);
    }

    return numberOfQueuedItems;
}
