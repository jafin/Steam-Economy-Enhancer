// The registry of every market row (list.js List) on the page, and the lookups over it.
//
// A row can be absent from the registry a caller expects it in -- removed by an earlier
// pass, not yet added because a page is still loading, or (per the comment below)
// duplicated into a list the search index didn't put it in. Both lookups below return
// `undefined` in that case rather than throwing, so every caller has to decide what an
// absent row means to it instead of crashing on a missing one.

export const marketLists: any[] = [];

export function getListFromContainer(group): any | undefined {
    for (let i = 0; i < marketLists.length; i++) {
        if (group[0].contains(marketLists[i].listContainer)) {
            return marketLists[i];
        }
    }

    return undefined;
}

export function getListingFromLists(listingid): any | undefined {
    // Sometimes listing ids are contained in multiple lists (?), use the last one available as this is the one we're most likely interested in.
    for (let i = marketLists.length - 1; i >= 0; i--) {
        let values = marketLists[i].get('market_listing_item_name', `mylisting_${listingid}_name`);
        if (values != null && values.length > 0) {
            return values[0];
        }

        values = marketLists[i].get('market_listing_item_name', `mbuyorder_${listingid}_name`);
        if (values != null && values.length > 0) {
            return values[0];
        }
    }

    return undefined;
}

export function removeListingFromLists(listingid) {
    for (let i = 0; i < marketLists.length; i++) {
        marketLists[i].remove('market_listing_item_name', `mylisting_${listingid}_name`);
        marketLists[i].remove('market_listing_item_name', `mbuyorder_${listingid}_name`);
    }
}
