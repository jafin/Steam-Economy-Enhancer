// What the user has selected in the inventory.
//
// Steam marks selection with a CSS class, so the selection is read back out of the DOM.
// Each of the three getters filters that selection down to the items its action can
// actually work on -- marketable, gem-able, or a booster pack. selectAllCards writes the
// same class from the other end, so that the "Select All Cards" button and a Ctrl-click
// leave the page in exactly the same state.

import $ from 'jquery';
import { getIsTradingCard } from '../items/index.ts';
import { steamPage } from '../steam/instance.ts';
import { getInventoryItems, loadAllInventories } from './data.ts';
// Gets the selected items in the inventory.
export function getSelectedItems() {
    return steamPage.selectedAssetIds();
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

// Selects every marketable trading card shown on the inventory page.
//
// The counterpart of "Sell All Cards", which filters the whole inventory itself and starts
// selling. This one only puts the selection where the user can see it, leaving what happens
// next -- sell, gem, unpack -- to the buttons that read it back through getSelectedItems().
//
// Scoped to the page currently on screen, and to the items on it Steam has not hidden while
// searching, because the selection those buttons act on has to be the one the user can see.
// The whole selection is cleared first, including on the other, hidden inventory pages: a
// plain click already clears across pages, and leaving a stale selection behind there would
// mean selling items that are not on screen.
export function selectAllCards() {
    const cardIds = new Set(
        getInventoryItems()
            .filter((item) => item.marketable && getIsTradingCard(item))
            .map((item) => item.assetid || item.id),
    );

    // classList rather than jQuery for the same reason as src/inventory/ui.ts: jQuery 4 does
    // not wrap a plain array of elements correctly, and fails quietly when it does not.
    $('.itemHolder.ui-selected').each(function () {
        this.classList.remove('ui-selected');
    });

    const visible = steamPage.visibleItemHolderSelector();

    $('.inventory_ctn').each(function () {
        $(this)
            .find(`.inventory_page${visible}`)
            .each(function () {
                $(this)
                    .find(`.itemHolder${visible}`)
                    .each(function () {
                        const itemHolder = this;

                        $(itemHolder)
                            .find('.item')
                            .each(function () {
                                const matches = this.id.match(/_(-?\d+)$/);
                                if (matches && cardIds.has(matches[1])) {
                                    itemHolder.classList.add('ui-selected');
                                }
                            });
                    });
            });
    });
}
