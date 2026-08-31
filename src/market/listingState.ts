// What the script worked out about a listing, kept as a value.
//
// The verdict -- overpriced, underpriced or fair -- used to live in a CSS class on the row
// and be read back out of the DOM. Keeping it as a value means the decision can be tested
// without a page.

import {
    VERDICT_FAIR,
    VERDICT_OVERPRICED,
    VERDICT_UNDERPRICED,
    type Verdict,
} from '../constants.ts';

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
export function getListingVerdict(bestPrice, listedPrice): Verdict {
    if (bestPrice < listedPrice) {
        return VERDICT_OVERPRICED;
    }

    if (bestPrice > listedPrice) {
        return VERDICT_UNDERPRICED;
    }

    return VERDICT_FAIR;
}

// How far a listing is from where it should be priced, in cents, signed: positive means
// the listing asks more than the best price. `bestPrice` and `listedPrice` are both prices
// including fees, and `bestPrice` is the price *without* the user's offset applied -- the
// same number the verdict above is computed from.
//
// The subtraction is trivial; which two numbers go into it is not. See
// docs/adr/0001-price-delta-measured-against-the-no-offset-best-price.md: measuring
// against the offset price instead would put a number on the row that disagrees with the
// colour beside it, and nothing would throw when it did. This function exists to give that
// choice a name and a test rather than leave it implicit in a subtraction inside a
// hundred-line callback.
export function getListingPriceDelta(bestPrice, listedPrice) {
    return listedPrice - bestPrice;
}

// One store for the page. The market listings and the trade offer inventory are never
// both on screen, so they cannot collide, and the keys differ anyway.
export const listingState = createListingState();
