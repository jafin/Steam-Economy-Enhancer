// Running totals for whatever the script is currently working through.
//
// These were five module-level `let` bindings in the single-file version. A module cannot
// assign to a binding it imported, and the inventory and market code both read and write
// all five, so they are properties of one object instead. Same values, same mutation
// points; only the way they are addressed changes.
//
// The object itself is not exported. It used to be, which meant every field was reachable
// from outside and so was a field the run's end could forget to reset -- nothing ever called
// a reset, and a second run on the same page load kept adding to the first one's numbers.
// Everything outside this module goes through the verbs below instead.

export interface RunTotals {
    /** Items this run has finished with, successfully or not. */
    processedQueueItems: number;
    /** Items this run has put on a queue. */
    queuedItems: number;
    /** What the listed items will fetch, including Steam's fees. */
    priceWithFeesOnMarket: number;
    /** What the seller actually receives for them. */
    priceWithoutFeesOnMarket: number;
    /** Gems obtained by grinding items down. */
    scrap: number;
}

const totals: RunTotals = {
    processedQueueItems: 0,
    queuedItems: 0,
    priceWithFeesOnMarket: 0,
    priceWithoutFeesOnMarket: 0,
    scrap: 0,
};

/** `n` items were put on a queue this run. */
export function queued(n: number): void {
    totals.queuedItems += n;
}

/** One item finished, successfully or not. */
export function processed(): void {
    totals.processedQueueItems++;
}

/**
 * A retryable Steam refusal put an already-processed item back on the queue. Not a reset --
 * a real decrement, distinct from processed() so the two cannot be confused for one another.
 */
export function unprocessed(): void {
    totals.processedQueueItems--;
}

/** An item was listed on the market, for `beforeFees` to the seller and `withFees` to the buyer. */
export function listed(beforeFees: number, withFees: number): void {
    totals.priceWithoutFeesOnMarket += beforeFees;
    totals.priceWithFeesOnMarket += withFees;
}

/** An item was ground into `gems` worth of goo. */
export function scrapped(gems: number): void {
    totals.scrap += gems;
}

// Reset by onQueueDrain when a run finishes, not by each queue -- several queues can be
// working at once and the totals are for the run, not the queue.
export function endRun(): void {
    totals.processedQueueItems = 0;
    totals.queuedItems = 0;
    totals.priceWithFeesOnMarket = 0;
    totals.priceWithoutFeesOnMarket = 0;
    totals.scrap = 0;
}

/** What updateTotals renders, and what the queues read back to build their progress prefix. */
export function runTotals(): Readonly<RunTotals> {
    return totals;
}
