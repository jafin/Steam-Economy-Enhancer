// How fast an item moves, and where this listing is in the line.
//
// Four numbers, all of them derived from answers market/listings.ts already has in hand for
// every row -- the price history and the order book it prices against. Nothing here costs a
// request:
//
//   salesVolume    what sold in a window            <- price history
//   salesRate      what sells per day               <- price history
//   queueAheadOf   listings that must sell first    <- order book
//   daysToSell     the two of them, divided         <- both
//
// Steam's /market/pricehistory/ answer is an array of [date, price, quantity sold], one
// entry per hour that saw a sale (older entries collapse to a day each, but the recent end
// -- all this reads -- is hourly). Its /market/orderbook answer carries rgCompactSellOrders,
// which buildOrderBook (steam/market.ts) turns into a sell_order_graph of [price, quantity]
// pairs, one per distinct price rather than a running total: the quantities sum to the
// cSellOrders the same answer reports, which is what makes a count at or below a price a
// plain filtered sum rather than a lookup into a cumulative curve.
//
// The clock is a parameter, like everywhere else in pricing/: it is what makes a window
// assertable without waiting for one.

/** Sales counted over one day. What "24h sold" means on a row. */
export const VOLUME_WINDOW_HOURS = 24;

/** The rate window, and the wider one it falls back to. */
export const RATE_WINDOW_HOURS = 24 * 7;
export const RATE_FALLBACK_WINDOW_HOURS = 24 * 30;

export interface SalesRate {
    /** Items sold per day over `windowHours`. */
    perDay: number;
    /** Which window that rate came from, so the label can say which. */
    windowHours: number;
}

/**
 * Items sold in the last `hours` according to `history`, or null if there is no history to
 * count.
 *
 * Null and zero are different answers and the caller has to keep them apart: null is "not
 * known", which is what a market pass running an algorithm that never fetches the history
 * produces (see getPriceHistory in steam/market.ts), while zero is Steam saying the item did
 * not sell. Rendering the first as `0` would be an invented figure.
 */
export function salesVolume(history, opts: { now: number; hours?: number }): number | null {
    if (!Array.isArray(history)) {
        return null;
    }

    const since = opts.now - (opts.hours ?? VOLUME_WINDOW_HOURS) * 60 * 60 * 1000;

    let total = 0;

    for (const entry of history) {
        if (!Array.isArray(entry)) {
            continue;
        }

        // Same date read as calculateAverageHistoryPriceBeforeFees, and same consequence for
        // a date this parses to NaN: the comparison is false, so the entry is left out
        // rather than counted at an unknown time.
        const at = new Date(entry[0]).getTime();
        const quantity = entry[2];

        if (at > since && Number.isFinite(quantity)) {
            total += quantity;
        }
    }

    return total;
}

/**
 * Sales per day: the last week, widening to the last month if the week saw no sales at all.
 *
 * A week is the responsive window -- a game going on sale, or a card being spammed, shows up
 * in it within days, and that is the change worth pricing against. But a week is also short
 * enough that a perfectly healthy card can go through one without a sale: on the listings
 * this was written against, a card with 69 sales in a month had none in the last day and 12
 * in the last week, and a second had none in either.
 *
 * Dividing a queue by a week of nothing yields an infinite wait for an item that in fact
 * sells twice a day. That is worse than useless -- it is confidently wrong in the direction
 * that would talk someone out of a listing that is fine. So the week is used when it has
 * anything to say and the month answers when it does not.
 *
 * The window that produced the rate comes back with it, because the reader has to be told
 * which one they are looking at: a rate whose window is invisible cannot be compared between
 * two rows.
 */
export function salesRate(history, opts: { now: number }): SalesRate | null {
    const week = salesVolume(history, { now: opts.now, hours: RATE_WINDOW_HOURS });

    if (week == null) {
        return null;
    }

    if (week > 0) {
        return { perDay: week / (RATE_WINDOW_HOURS / 24), windowHours: RATE_WINDOW_HOURS };
    }

    const month = salesVolume(history, { now: opts.now, hours: RATE_FALLBACK_WINDOW_HOURS });

    return {
        perDay: (month ?? 0) / (RATE_FALLBACK_WINDOW_HOURS / 24),
        windowHours: RATE_FALLBACK_WINDOW_HOURS,
    };
}

/**
 * Everything on the sell side priced at or below `priceInCents`, this listing included.
 *
 * The graph's prices are in currency units -- buildOrderBook divides Steam's cents by 100 --
 * and the row's price is in cents, so the comparison rounds back rather than dividing: 0.05
 * times 100 is not exactly 5 in binary floating point, and an item priced at exactly the
 * user's own price would fall out of its own count about as often as not.
 */
export function listingsAtOrBelow(orderbook, priceInCents: number): number | null {
    if (orderbook == null || !Array.isArray(orderbook.sell_order_graph)) {
        return null;
    }

    let total = 0;

    for (const entry of orderbook.sell_order_graph) {
        if (!Array.isArray(entry)) {
            continue;
        }

        const cents = Math.round(entry[0] * 100);
        const quantity = entry[1];

        if (Number.isFinite(cents) && Number.isFinite(quantity) && cents <= priceInCents) {
            total += quantity;
        }
    }

    return total;
}

/**
 * Listings that have to sell before this one does.
 *
 * The order book counts this listing too, so one comes off the total: an "ahead of you" that
 * includes you is not a queue position. It is exactly one even when the user holds several
 * listings of the same card at the same price -- each row subtracts itself, and each row's
 * answer is the right one for that row.
 *
 * Floored at zero rather than going negative on the one case where the book has not caught
 * up with a listing yet: a row created moments ago can be missing from an order book Steam
 * is still caching, and a queue of -1 would be a stranger thing to show than a queue of 0.
 */
export function queueAheadOf(orderbook, priceInCents: number): number | null {
    const total = listingsAtOrBelow(orderbook, priceInCents);

    if (total == null) {
        return null;
    }

    return Math.max(0, total - 1);
}

/**
 * Days before this listing is likely to sell: the queue ahead of it, plus itself, at the
 * going rate.
 *
 * Plus itself because the question is when *this* item sells, not when the queue clears. It
 * is what stops the first listing in line reading as "0 days", which would say the sale is
 * already done rather than that it is next -- at two sales a day, being next is half a day
 * away, and that is the honest answer.
 *
 * Null when the rate is zero or unknown. An item nothing has bought in a month has no
 * meaningful answer here, and a very large number of days is a worse way of saying so than
 * no number at all.
 */
export function daysToSell(queueAhead: number | null, rate: SalesRate | null): number | null {
    if (queueAhead == null || rate == null || rate.perDay <= 0) {
        return null;
    }

    return (queueAhead + 1) / rate.perDay;
}

/** `2.3`, `16` -- one decimal until the figure is big enough that the decimal is noise. */
export function formatSalesRate(rate: SalesRate | null): string {
    if (rate == null) {
        return '—';
    }

    if (rate.perDay === 0) {
        return '0';
    }

    return rate.perDay >= 100 ? String(Math.round(rate.perDay)) : rate.perDay.toFixed(1);
}

/**
 * How long is too long. A listing past the first threshold is slow; past the second it has
 * effectively stalled.
 *
 * Two weeks is the point where a card is no longer "about to sell" -- Steam holds the funds
 * until it does, so an estimate beyond it is money the user has parked rather than earned. A
 * month is where relisting lower stops being a judgement call: at that horizon the queue is
 * deep enough that waiting it out is not a plan.
 *
 * Exclusive at both ends, so exactly 15 days is not yet slow and exactly 30 is not yet
 * stalled. A threshold that fires on the number it is named after reads as a lie to anyone
 * checking it against the cell beside it.
 */
export const DAYS_TO_SELL_SLOW = 15;
export const DAYS_TO_SELL_STALLED = 30;

export type SellSpeed = 'slow' | 'stalled';

/**
 * Which of the two thresholds an estimate has crossed, if either.
 *
 * Null for a comfortable estimate and null for no estimate at all, deliberately: the absence
 * of a number is not a warning, and colouring a dash red would say the item has stalled when
 * what is actually true is that nothing is known about it. The tooltip on that cell already
 * explains the dash.
 */
export function sellSpeedOf(days: number | null): SellSpeed | null {
    if (days == null) {
        return null;
    }

    if (days > DAYS_TO_SELL_STALLED) {
        return 'stalled';
    }

    if (days > DAYS_TO_SELL_SLOW) {
        return 'slow';
    }

    return null;
}

/**
 * `77d`, `<1d`, `999+d`.
 *
 * Rounded to whole days above one, because the input is a rate averaged over a week or a
 * month: an estimate of `76.8d` claims a precision the arithmetic behind it does not have.
 */
export function formatDaysToSell(days: number | null): string {
    if (days == null) {
        return '—';
    }

    if (days < 1) {
        return '<1d';
    }

    if (days > 999) {
        return '999+d';
    }

    return `${Math.round(days)}d`;
}
