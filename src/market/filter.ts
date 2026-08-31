// Filtering the listings down to the overpriced ones.
//
// A list.js filter is all this needs. Every market button already acts on
// list.matchingItems, so taking a row out of the match set takes it out of the buttons'
// reach as well: the counts on the overpriced buttons, "Select all", "Relist selected" and
// "Remove selected" all follow the filter without knowing it exists. It composes with the
// search box for the same reason -- list.js tracks the searched and the filtered flag
// separately and a row has to satisfy both to match.
//
// The catch is *when* the class it filters on is written. The pricing pass adds `overpriced`
// one row at a time over the length of a run, while list.js decides membership at the moment
// filter() runs and caches it on the item. A filter applied only on the change event would
// therefore freeze the list to whatever had been priced by the time the box was ticked --
// every row priced afterwards would stay hidden however overpriced it turned out to be. So
// the filter is re-applied on every button refresh (see updateMarketOverpricedButtons), which
// is driven by the same workDone() that follows each priced listing.

import { VERDICT_OVERPRICED } from '../constants.ts';
import $ from 'jquery';

/** Whether this section's "Overpriced only" box is ticked. */
export function isOverpricedFilterOn(group): boolean {
    return $('.market_overpriced_filter', group).is(':checked');
}

/** Apply or clear this section's overpriced filter, according to its checkbox. */
export function applyOverpricedFilter(list, group): void {
    if (isOverpricedFilterOn(group)) {
        list.filter((item) => $(item.elm).hasClass(VERDICT_OVERPRICED));
    } else {
        list.filter();
    }
}

/**
 * Re-apply the filter if it is on, so rows priced since the last pass join or leave it.
 *
 * Only if it is on: clearing a filter that was never set still walks every item and
 * re-renders the list, and this runs once a frame for the whole of a pricing pass. A box
 * that was just unticked is cleared by the change handler in market/ui.ts instead.
 */
export function refreshOverpricedFilter(list, group): void {
    if (!isOverpricedFilterOn(group)) {
        return;
    }

    applyOverpricedFilter(list, group);
}
