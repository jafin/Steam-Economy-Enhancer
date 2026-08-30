// Reading the inventory, and pricing what is in it.
//
// Steam loads an inventory page at a time, so anything that works over the whole inventory
// has to ask for the rest first. The price queue fills in the lowest listed price for each
// item, which is what the price labels and the quick-sell buttons display.

import $ from 'jquery';
import { listingState } from '../market/listingState.ts';
import { PAGE_TRADEOFFER } from '../constants.ts';
import { getAssetKey, readInventoryItems } from '../items/index.ts';
import {
    NO_LISTING_PRICE_SENTINEL,
    calculateSellPriceBeforeFees,
    createPricingRules,
    formatPrice,
} from '../pricing/algorithms.ts';
import { fetchPricingInputs } from '../pricing/inputs.ts';
import { runQueue } from '../queue/index.ts';
import { currentPage, steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
// Loads all inventories.
export async function loadAllInventories() {
    const main = getActiveInventory();

    const childs = Object.values(main.m_rgChildInventories);

    for (const inventory of [...childs, main]) {
        await new Promise((resolve) => inventory.LoadCompleteInventory().done(resolve));
    }
}

// Gets the inventory items from the active inventory.
export function getInventoryItems() {
    return readInventoryItems(getActiveInventory(), 'm_rgChildInventories', 'm_rgAssets');
}

// Gets the active inventory.
export function getActiveInventory() {
    return steamPage.activeInventory();
}

// Sets the prices for the items.
export function setInventoryPrices(items) {
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
export const inventoryPriceQueue = runQueue(inventoryPriceQueueWorker, { retryOnFailure: true });

export function inventoryPriceQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;

    // Only get the market orders here, the history is not important to visualize the current prices.
    fetchPricingInputs(
        item,
        { history: false, name: itemName },
        ({ orderbook, failed, cached }) => {
            if (failed > 0 && !ignoreErrors) {
                return callback(false, cached);
            }

            // Nobody to undercut, so the bounds are overridden explicitly rather than taken from
            // an item's settings-derived class: no minimum, and a ceiling that reads back as
            // "unpriced" instead of a real price.
            const sellPrice = calculateSellPriceBeforeFees(null, orderbook, false, {
                ...createPricingRules(),
                minPriceBeforeFees: 0,
                maxPriceBeforeFees: NO_LISTING_PRICE_SENTINEL,
            });

            // Nobody is selling this one, so there is no price to show and nothing to
            // add to a trade offer total.
            const priceWithFees =
                sellPrice == NO_LISTING_PRICE_SENTINEL
                    ? 0
                    : market.getPriceIncludingFees(sellPrice);
            const itemPrice =
                sellPrice == NO_LISTING_PRICE_SENTINEL ? '∞' : formatPrice(priceWithFees);

            listingState.set(getAssetKey(item), { sellPrice: priceWithFees });

            const elementName = `${currentPage == PAGE_TRADEOFFER ? '#item' : '#'}${getAssetKey(item)}`;
            const element = $(elementName);

            $('.inventory_item_price', element).remove();
            element.append(`<span class="inventory_item_price">${itemPrice}</span>`);

            return callback(true, cached);
        },
    );
}
