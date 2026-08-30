// Progress of a market run.
//
// The relist and remove actions can each queue hundreds of listings, so the buttons carry a
// progress bar. The counters are reset only once nothing is queueing relists any more, not
// per queue -- see resetMarketRelistProgress.

import { marketRelistQueuedListings, refreshMarketOverpricedButtons } from './relist.ts';

/**
 * Progress of the current relist run.
 *
 * One object rather than two loose bindings because market/ui.ts and market/relist.ts both
 * write to these, and a module cannot assign to a binding it imported. Reset together by
 * resetMarketRelistProgress once nothing is queueing relists any more -- not per queue, since
 * several can be draining at once.
 */
export const marketProgress = {
    /** Listings this run intends to relist. */
    relistTotal: 0,
    /** Listings it has finished relisting. */
    relistDone: 0,
};

// The <progress> element the market header carries. Not part of marketProgress above: it is
// written once, from market/ui.ts, well before anything here reads it, and every read went
// unguarded -- setProgressBar and the null checks below are what stop a page where the market
// header failed to build from throwing out of increaseMarketProgress instead.
let bar: HTMLProgressElement | null = null;

export function setProgressBar(el: HTMLProgressElement): void {
    bar = el;
}

// Progress of the current relist run, shown on the relist overpriced button.
// Both are reset once nothing is queueing relists any more, see resetMarketRelistProgress.

export function increaseMarketProgressMax() {
    if (bar == null) {
        return;
    }

    let value = bar.max;

    // Reset the progress bar if it already completed
    if (bar.value === value) {
        bar.value = 0;
        value = 0;
    }

    bar.max = value + 1;
    bar.removeAttribute('hidden');
}

export function increaseMarketProgress() {
    if (bar == null) {
        return;
    }

    bar.value += 1;

    if (bar.value === bar.max) {
        bar.setAttribute('hidden', 'true');
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
