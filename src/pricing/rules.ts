// Everything the price calculation takes from settings, read in one place.
//
// The calculation used to reach for these itself: four settings across three functions, one
// synchronous localStorage read per item priced, plus the wall clock, the wallet's fee
// schedule and the round-vs-floor currency rule, the last two taken from a module-level
// `market`/`useRound` closure. Passing them in means the same inputs always give the same
// answer, which is what makes the calculation testable.
//
// createPricingRules() in the entry file builds one of these from the user's settings, the
// wallet and the clock. Every field is optional: each calculation uses a subset, and callers
// -- the tests especially -- pass only the fields the calculation under test reads. That is
// the existing runtime contract, not a loosening of it.

export interface PricingRules {
    /** Which pricing algorithm the user chose. */
    algorithm?: number;
    /** The user's price offset, in cents. */
    offsetCents?: number;
    /** How far back the price history is averaged over. */
    historyHours?: number;
    /** Whether a low-quantity lowest listing is ignored as an outlier. */
    ignoreLowestOnLowQuantity?: boolean;
    /** Steam's wallet descriptor. Its fields arrive as numbers or numeric strings. */
    walletInfo?: any;
    /** Whether this currency rounds rather than floors its fees. */
    useRound?: boolean;
    /** The current time, injected so history averaging is deterministic under test. */
    now?: number;
}
