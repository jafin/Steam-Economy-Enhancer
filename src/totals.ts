// Running totals for whatever the script is currently working through.
//
// These were five module-level `let` bindings in the single-file version. A module cannot
// assign to a binding it imported, and the inventory and market code both read and write
// all five, so they are properties of one object instead. Same values, same mutation
// points; only the way they are addressed changes.
//
// Reset by onQueueDrain when a run finishes, not by each queue -- several queues can be
// working at once and the totals are for the run, not the queue.

export const totals = {
    /** Items this run has finished with, successfully or not. */
    processedQueueItems: 0,
    /** Items this run has put on a queue. */
    queuedItems: 0,
    /** What the listed items will fetch, including Steam's fees. */
    priceWithFeesOnMarket: 0,
    /** What the seller actually receives for them. */
    priceWithoutFeesOnMarket: 0,
    /** Gems obtained by grinding items down. */
    scrap: 0,
};
