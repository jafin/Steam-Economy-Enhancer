// What the script knows about a Steam item.
//
// Steam hands items back in two different shapes depending on the page, with the fields
// that matter split between the item and a nested description. These functions flatten that
// difference and answer the questions the rest of the script asks: what is this called on
// the market, is it a trading card, is it a crate, has it already been queued.

import { createListingState } from '../market/listingState.ts';

// Whether an item has already been queued for an inventory action (sell, turn into gems,
// unpack), kept by asset key instead of on the item itself. readInventoryItems used to stamp
// `item.queued` directly onto Steam's own object, so a second pass over the same inventory --
// the user clicking "Sell All" and "Turn Into Gems" moments apart -- saw the flag on the very
// same object and skipped it. readInventoryItems now returns a new object every call, so
// that no longer works; this is where the flag lives instead.
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

// The item's display name, for logging and for the name-shaped checks the inventory makes.
//
// `item.name || item.description.name` is the idiom this codebase already writes in six
// places, because an inventory item carries its name at the top level on some pages and only
// on its description on others. Written out inline it dereferences `description` without
// checking it, so an item with neither threw -- in updateInventorySelection that took the
// whole quick-sell panel with it, silently. Distinct from getMarketHashName above, which
// answers what to *ask Steam* for and prefers the description; this answers what to *show*.
export function getItemName(item): string {
    if (item == null) {
        return '';
    }

    return item.name || item.description?.name || '';
}

// The items that are not the first of their classid -- what "duplicates" means to the sell
// and gem actions.
//
// A single pass. The form this replaces rebuilt a full array of every classid *per element*
// -- `items.map((m) => m.classid).indexOf(e.classid) !== i` -- which is O(n^2) in both time
// and allocation: 213ms on a 5,000-item inventory against 1ms for this, byte-identical
// output. Steam inventories reach tens of thousands of items, and both call sites sit behind
// a button, so the old form simply locked the page up.
//
// Note what "first" means: the first *occurrence* is excluded and every later one is kept,
// so selling duplicates leaves one copy of each item. Order is preserved.
export function duplicatesByClassId(items: any[]): any[] {
    const seen = new Set();

    return items.filter((item) => {
        if (seen.has(item.classid)) {
            return true;
        }

        seen.add(item.classid);

        return false;
    });
}

// Tags live on the item itself on the inventory page and on its description on the market
// page, so every tag check has to look in both. Written out three times before this.
function tagsOf(item): any[] | null {
    if (item.tags != null) {
        return item.tags;
    }

    if (item.description != null && item.description.tags != null) {
        return item.description.tags;
    }

    return null;
}

// Whether any tag matches -- replaces the let/forEach/if dance getIsCrate, getIsTradingCard
// and getIsFoilTradingCard each wrote out. The original compared with `==`; these values are
// strings from Steam's JSON, so `===` is equivalent, and test/inventory-items.test.ts's
// fixtures are what says so.
function hasTag(item, category: string, internalName: string): boolean {
    return (tagsOf(item) ?? []).some(
        (tag) => tag.category === category && tag.internal_name === internalName,
    );
}

export function getIsCrate(item) {
    if (item == null) {
        return false;
    }
    // This is available on the inventory page.
    return hasTag(item, 'Type', 'Supply Crate');
}

export function getIsTradingCard(item) {
    if (item == null) {
        return false;
    }

    // This is available on the inventory page. item_class_2 is a trading card.
    if (hasTag(item, 'item_class', 'item_class_2')) {
        return true;
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

    // This is available on the inventory page. cardborder_1 is the foil border.
    if (hasTag(item, 'cardborder', 'cardborder_1')) {
        return true;
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
