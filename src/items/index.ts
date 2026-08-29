// What the script knows about a Steam item.
//
// Steam hands items back in two different shapes depending on the page, with the fields
// that matter split between the item and a nested description. These functions flatten that
// difference and answer the questions the rest of the script asks: what is this called on
// the market, is it a trading card, is it a crate, has it already been queued.

import { createListingState } from '../market/listingState.ts';

// Which items a queue has already taken. Keyed by asset key, so an item is never queued
// twice even when it appears in more than one selection.
const itemQueueState = createListingState();

// The key an inventory item's price is kept under. It is also the id Steam gives the
// item's element, so an item is found the same way in the state and on the page.
export function getAssetKey(item) {
    return `${item.appid}_${item.contextid}_${item.id}`;
}

export function isItemQueued(item) {
    return itemQueueState.get(getAssetKey(item))?.queued === true;
}

export function markItemQueued(item) {
    itemQueueState.set(getAssetKey(item), { queued: true });
}

// Flattens one Steam item: a new object with its own `description` merged onto it, so
// its fields read the same way whichever page it came from - the market page's items
// already arrive this way. `id` is stamped from the caller, because Steam's raw item is
// not always trusted to carry its own (see readInventoryItems). Steam's own object is
// left untouched; nothing here mutates `value`.
export function flattenItem(value, id) {
    const item = Object.assign({}, value, value.description);
    item.id = id;
    item.assetid = id;

    return item;
}

// Flattens Steam's inventory shape into one array of new objects. The inventory page's
// active inventory (m_rgChildInventories/m_rgAssets) and the trade offer page's
// (rgChildInventories/rgInventory) were byte-for-byte identical but for these two
// property names - one reader, parameterised by them, instead of the same walk written
// out twice.
export function readInventoryItems(activeInventory, childrenProperty, assetsProperty) {
    const items: any[] = [];

    if (!activeInventory) {
        return items;
    }

    const collect = (assets) => {
        for (const key in assets) {
            const value = assets[key];
            if (typeof value === 'object') {
                items.push(flattenItem(value, key));
            }
        }
    };

    for (const child in activeInventory[childrenProperty]) {
        collect(activeInventory[childrenProperty][child][assetsProperty]);
    }

    // Some inventories (e.g. BattleBlock Theater) do not have child inventories, they
    // have just one.
    collect(activeInventory[assetsProperty]);

    return items;
}

export function getMarketHashName(item) {
    if (item == null) {
        return null;
    }

    if (item.description != null && item.description.market_hash_name != null) {
        return item.description.market_hash_name;
    }

    if (item.description != null && item.description.name != null) {
        return item.description.name;
    }

    if (item.market_hash_name != null) {
        return item.market_hash_name;
    }

    if (item.name != null) {
        return item.name;
    }

    return null;
}

export function getIsCrate(item) {
    if (item == null) {
        return false;
    }
    // This is available on the inventory page.
    const tags =
        item.tags != null
            ? item.tags
            : item.description != null && item.description.tags != null
              ? item.description.tags
              : null;
    if (tags != null) {
        let isTaggedAsCrate = false;
        tags.forEach((arrayItem) => {
            if (arrayItem.category == 'Type') {
                if (arrayItem.internal_name == 'Supply Crate') {
                    isTaggedAsCrate = true;
                }
            }
        });
        if (isTaggedAsCrate) {
            return true;
        }
    }

    return false;
}

export function getIsTradingCard(item) {
    if (item == null) {
        return false;
    }

    // This is available on the inventory page.
    const tags =
        item.tags != null
            ? item.tags
            : item.description != null && item.description.tags != null
              ? item.description.tags
              : null;
    if (tags != null) {
        let isTaggedAsTradingCard = false;
        tags.forEach((arrayItem) => {
            if (arrayItem.category == 'item_class') {
                if (arrayItem.internal_name == 'item_class_2') {
                    // trading card.
                    isTaggedAsTradingCard = true;
                }
            }
        });
        if (isTaggedAsTradingCard) {
            return true;
        }
    }

    // This is available on the market page.
    if (item.owner_actions != null) {
        for (let i = 0; i < item.owner_actions.length; i++) {
            if (item.owner_actions[i].link == null) {
                continue;
            }

            // Cards include a link to the gamecard page.
            // For example: "http://steamcommunity.com/my/gamecards/503820/".
            if (item.owner_actions[i].link.toString().toLowerCase().includes('gamecards')) {
                return true;
            }
        }
    }

    // A fallback for the market page (only works with language on English).
    if (item.type != null && item.type.toLowerCase().includes('trading card')) {
        return true;
    }

    return false;
}

export function getIsFoilTradingCard(item) {
    if (!getIsTradingCard(item)) {
        return false;
    }

    // This is available on the inventory page.
    const tags =
        item.tags != null
            ? item.tags
            : item.description != null && item.description.tags != null
              ? item.description.tags
              : null;
    if (tags != null) {
        let isTaggedAsFoilTradingCard = false;
        tags.forEach((arrayItem) => {
            if (arrayItem.category == 'cardborder' && arrayItem.internal_name == 'cardborder_1') {
                // foil border.
                isTaggedAsFoilTradingCard = true;
            }
        });
        if (isTaggedAsFoilTradingCard) {
            return true;
        }
    }

    // This is available on the market page.
    if (item.owner_actions != null) {
        for (let i = 0; i < item.owner_actions.length; i++) {
            if (item.owner_actions[i].link == null) {
                continue;
            }

            // Cards include a link to the gamecard page.
            // The border parameter specifies the foil cards.
            // For example: "http://steamcommunity.com/my/gamecards/503820/?border=1".
            if (
                item.owner_actions[i].link.toString().toLowerCase().includes('gamecards') &&
                item.owner_actions[i].link.toString().toLowerCase().includes('border')
            ) {
                return true;
            }
        }
    }

    // A fallback for the market page (only works with language on English).
    if (item.type != null && item.type.toLowerCase().includes('foil trading card')) {
        return true;
    }

    return false;
}
