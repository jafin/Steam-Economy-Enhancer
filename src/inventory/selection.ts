// What the user has selected in the inventory.
//
// Steam marks selection with a CSS class, so the selection is read back out of the DOM.
// Each of the three getters filters that selection down to the items its action can
// actually work on -- marketable, gem-able, or a booster pack.

import $ from 'jquery';
import { getInventoryItems, loadAllInventories } from './data.ts';
// Gets the selected items in the inventory.
export function getSelectedItems() {
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
export function getInventorySelectedMarketableItems(callback) {
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
export function getInventorySelectedGemsItems(callback) {
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
export function getInventorySelectedBoosterPackItems(callback) {
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
