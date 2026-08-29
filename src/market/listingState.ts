// What the script worked out about a listing, kept as a value.
//
// The verdict -- overpriced, underpriced or fair -- used to live in a CSS class on the row
// and be read back out of the DOM. Keeping it as a value means the decision can be tested
// without a page.

import { VERDICT_FAIR, VERDICT_OVERPRICED, VERDICT_UNDERPRICED } from '../constants.ts';

//#region Listing state
// What the script worked out about a listing, kept as a value.
//
// The price and the verdict used to live in the class attribute of the listing element:
// the price was written as `price_1234` and read back by splitting the class list and
// parsing the number out of it. That made a CSS class the data model, so renaming one
// silently lost the price instead of failing. The classes are still written for styling
// and for the selector-based selection, but this is the source of truth.
//
// Keyed by listing id on the market page and by `appid_contextid_assetid` on the trade
// offer page. `set` merges, because the price is known before the verdict is.
export function createListingState() {
    const states = new Map();

    return {
        get(id) {
            return states.get(String(id));
        },
        set(id, state) {
            const key = String(id);
            states.set(key, Object.assign({}, states.get(key), state));
        },
    };
}

// What the script thinks of the price a listing is asking, as a value rather than as a
// colour and a class name. `bestPrice` and `listedPrice` are both prices including fees.
export function getListingVerdict(bestPrice, listedPrice) {
    if (bestPrice < listedPrice) {
        return VERDICT_OVERPRICED;
    }

    if (bestPrice > listedPrice) {
        return VERDICT_UNDERPRICED;
    }

    return VERDICT_FAIR;
}

// How far a listing is from where it should be priced, as a signed value. `bestPrice` and
// `listedPrice` are both prices including fees, and `bestPrice` is the price *without* the
// user's offset applied -- the same number the verdict above is computed from. See
// docs/adr/0001-price-delta-measured-against-the-no-offset-best-price.md: measuring
// against the offset price instead would put a number on the row that disagrees with the
// colour beside it, and nothing would throw when it did.
//
// The percentage is a fraction of the best price rather than of the listed price, so that
// the overpriced and underpriced sides share one fixed reference: two listings equally far
// from the market then report the same magnitude, which a moving denominator would not do.
//
// A best price of zero has no meaningful percentage -- the division is infinite, not
// large -- so it comes back null and the caller renders the amount alone.
export function getListingPriceDelta(bestPrice, listedPrice) {
    const cents = listedPrice - bestPrice;

    return {
        cents: cents,
        percent: bestPrice === 0 ? null : (cents / bestPrice) * 100,
    };
}

// One store for the page. The market listings and the trade offer inventory are never
// both on screen, so they cannot collide, and the keys differ anyway.
export const listingState = createListingState();
