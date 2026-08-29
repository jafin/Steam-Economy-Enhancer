// Progress of a market run.
//
// The relist and remove actions can each queue hundreds of listings, so the buttons carry a
// progress bar. The counters are reset only once nothing is queueing relists any more, not
// per queue -- see resetMarketRelistProgress.

/**
 * Progress of the current relist run.
 *
 * One object rather than three loose bindings because market/ui.ts and market/relist.ts
 * both write to these, and a module cannot assign to a binding it imported. Reset together
 * by resetMarketRelistProgress once nothing is queueing relists any more -- not per queue,
 * since several can be draining at once.
 */
export const marketProgress = {
    /** The <progress> element the market header carries, once the UI has built it. */
    bar: null as any,
    /** Listings this run intends to relist. */
    relistTotal: 0,
    /** Listings it has finished relisting. */
    relistDone: 0,
};

import { marketRelistQueuedListings, refreshMarketOverpricedButtons } from './relist.ts';

// Progress of the current relist run, shown on the relist overpriced button.
// Both are reset once nothing is queueing relists any more, see resetMarketRelistProgress.

export function increaseMarketProgressMax() {
    let value = marketProgress.bar.max;

    // Reset the progress bar if it already completed
    if (marketProgress.bar.value === value) {
        marketProgress.bar.value = 0;
        value = 0;
    }

    marketProgress.bar.max = value + 1;
    marketProgress.bar.removeAttribute('hidden');
}

export function increaseMarketProgress() {
    marketProgress.bar.value += 1;

    if (marketProgress.bar.value === marketProgress.bar.max) {
        marketProgress.bar.setAttribute('hidden', 'true');
    }

    // A listing was just priced, relisted or removed, so the overpriced count may have changed.
    refreshMarketOverpricedButtons();
}

// The relist run is over, put the buttons back to showing the (now lower) overpriced count.
export function resetMarketRelistProgress() {
    marketProgress.relistTotal = 0;
    marketProgress.relistDone = 0;
    marketRelistQueuedListings.clear();

    refreshMarketOverpricedButtons();
}
