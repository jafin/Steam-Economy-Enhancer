// The one load-filter-enqueue pipeline nine inventory actions used to repeat by hand.
//
// Each of gems, boosters and sell rendered a spinner, walked the whole inventory, filtered it
// by a capability, skipped items a queue already had, marked and queued the rest, and folded
// the count into the run totals -- six probe sites doing the same `owner_actions` walk, and an
// enqueue tail that drifted between the label a button showed and what its click actually did.
// See .docs/tasks/TASK-03-inventory-action-pipeline.md for the drift this fixes.

import { isItemQueued, markItemQueued } from '../items/index.ts';
import { queued } from '../totals.ts';
import { removeSpinner, renderSpinner } from '../ui/index.ts';
import { logConsole, logDOM } from '../ui/logger.ts';
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

    // for...of, not for...in. owner_actions is an array, and for...in walks inherited
    // enumerable properties and yields string keys -- steam/market.ts iterates the same array
    // with for...of, and the two disagreed on idiom for the same data.
    for (const action of item.owner_actions) {
        if (action?.link != null && action.link.includes(fragment)) {
            return true;
        }
    }

    return false;
}

// Load the inventory, then act on it -- with both ends of the spinner closed.
//
// Eight actions wrote this out by hand, and every one of them called removeSpinner only on
// the success path. A refused or hanging inventory load therefore left the user watching a
// spinner that never stopped, an unhandled rejection in the console, and nothing at all on
// the page -- the exact failure mode net/request.ts's breaker was written to avoid: "Going
// quiet without saying so is not: announce it."
//
// The rejection handler is `.then`'s second argument rather than a trailing `.catch`,
// deliberately. A trailing .catch would also catch anything `action` itself threw and report
// it to the user as a failed inventory load, which it is not. This way the handler sees load
// failures only; an error inside `action` behaves exactly as it does today, and the spinner
// is already down by then either way.
export function withInventory(action: () => void, label = 'Loading inventory items'): void {
    renderSpinner(label);

    loadAllInventories().then(
        () => {
            removeSpinner();
            action();
        },
        (e) => {
            removeSpinner();
            logDOM('Could not load the inventory. Reload the page and try again.');
            logConsole(`loadAllInventories failed, ${e}.`);
        },
    );
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
