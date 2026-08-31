// The listings a market button acts on.
//
// initializeMarketUI() (./ui.ts) appends every row of buttons straight into a section's
// .my_market_header, so .market_listing_buttons -> .my_market_header -> .market_home_listing_table
// is the walk from a click inside a button to the section that holds both the buttons and
// the list they act on. A click can land anywhere inside a button -- the label span, the
// icon, the anchor -- which is why the walk used to be four raw parent hops in seven places
// and two in others, with nothing checking the two counts still agreed. Anchoring on
// .market_listing_buttons first, which is markup this script writes and never nests, turns
// both into the same two-hop walk from there; see the "Watch out" note in TASK-05 for why
// that is not the same as anchoring on Steam's own section class directly.

import { getListFromContainer } from './rows.ts';
import $ from 'jquery';

/**
 * The .market_home_listing_table section a market button (or a click inside one) belongs
 * to. Exported on its own, not only through selectionFor, because
 * updateMarketSelectAllButton needs it for a section whose list has not registered yet --
 * an empty buy-orders block, for instance -- and must keep updating the button text there
 * regardless.
 */
export function marketSectionFor(target: any) {
    return $(target).closest('.market_listing_buttons').parent().parent();
}

/** Given a click target inside a market button, the list and rows that button acts on. */
export function selectionFor(target: any): { list: any; rows: any[]; group: any } | null {
    const group = marketSectionFor(target);
    const list = getListFromContainer(group);

    if (list == null) {
        return null;
    }

    return { list, rows: list.matchingItems, group };
}

/**
 * The .market_home_listing_table section whose column was clicked, for the sort/search
 * table header. This resolves a different thing than a button does -- which column was
 * clicked, not which listings are selected -- and a header click has no
 * .market_listing_buttons ancestor to anchor on, so it does not fit selectionFor.
 *
 * Anchored on the section rather than counted in parent hops. The two-hop walk this
 * replaces was correct only for a span that is a direct child of
 * .market_listing_table_header: market/ui.ts binds the sort with a delegated
 * .on('click', 'span', ...), so a span nested inside a header span fired the handler a
 * second time with the walk landing on the header instead, every column flag came back
 * false, and sortMarketListings threw. .closest() resolves the same section for the
 * direct-child case and the right one for the nested case, which is why this is the root
 * fix and the guard in sort.ts is the belt.
 *
 * Note this anchors on Steam's own .market_home_listing_table, unlike marketSectionFor
 * above, which anchors on .market_listing_buttons -- markup this script writes and never
 * nests. The header is Steam's, so there is no such anchor of ours to use here.
 */
export function tableHeaderSectionFor(target: any) {
    return $(target).closest('.market_home_listing_table');
}
