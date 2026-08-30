// Progress of a market run.
//
// The relist and remove actions can each queue hundreds of listings, so the buttons carry a
// progress bar. The counters are reset only once nothing is queueing relists any more, not
// per queue -- see resetMarketRelistProgress.

import { SETTING_RELIST_AUTOMATICALLY, getSetting } from '../settings/index.ts';
import { marketListingsQueue } from './listings.ts';
import {
    marketOverpricedQueue,
    marketRelistQueuedListings,
    refreshMarketOverpricedButtons,
} from './relist.ts';

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
// unguarded -- setProgressBar and the null check in render() are what stop a page where the
// market header failed to build from throwing out of workDone instead.
let bar: HTMLProgressElement | null = null;

export function setProgressBar(el: HTMLProgressElement): void {
    bar = el;
}

// The bar's own counter: how much work this run declared with addWork(), and how much of it
// workDone() has finished. Plain numbers rather than fields on the <progress> element itself,
// so the count can be asserted with no DOM in the loop -- see test/market-progress.test.ts.
interface ProgressCounter {
    total: number;
    done: number;
}

const progress: ProgressCounter = { total: 0, done: 0 };

// The only place progress and bar meet. Writes max, value and hidden from the counter in one
// step, rather than the counter and the element drifting out of step the way bar.max and
// bar.value used to.
function render(): void {
    if (bar == null) {
        return;
    }

    bar.max = progress.total;
    bar.value = progress.done;

    if (progress.total > 0 && progress.done < progress.total) {
        bar.removeAttribute('hidden');
    } else {
        bar.setAttribute('hidden', 'true');
    }
}

/**
 * Declare `n` more items of work queued this run.
 *
 * A market page can run several passes, so a batch that starts after the previous one
 * finished is a new run, not more of the last one: if the counter is already at a completed
 * total (done caught up with total), the count starts over rather than piling onto a run
 * that is already done.
 */
export function addWork(n: number): void {
    if (progress.total > 0 && progress.done >= progress.total) {
        progress.total = 0;
        progress.done = 0;
    }

    progress.total += n;
    render();
}

/** `n` items of the declared work finished, successfully or not. */
export function workDone(n = 1): void {
    progress.done = Math.min(progress.done + n, progress.total);
    render();

    // A listing was just priced, relisted or removed, so the overpriced count may have changed.
    refreshMarketOverpricedButtons();
}

/** The bar's counter, assertable with no DOM. */
export function progressState(): { total: number; done: number } {
    return progress;
}

// The relist run is over, put the buttons back to showing the (now lower) overpriced count.
export function resetMarketRelistProgress() {
    marketProgress.relistTotal = 0;
    marketProgress.relistDone = 0;
    marketRelistQueuedListings.clear();

    refreshMarketOverpricedButtons();
}

// Automatic relisting feeds marketOverpricedQueue while the pricing pass is still finding
// overpriced listings, so it drains every time it happens to catch up with the pass.
// Clearing the progress there restarts the count from zero halfway through the run,
// so the queue that finishes last is the one that clears it.
//
// Only *automatic* relisting, though. The pricing pass queues a relist from one place
// (market/listings.ts), and only when SETTING_RELIST_AUTOMATICALLY is on. With it off the
// pass is not a source of relists, so waiting for it means a user who clicks "Relist
// overpriced" during a scan watches the button sit at N/N and disabled for the rest of the
// pass -- minutes, on a few hundred listings -- for a run that ended when the queue drained.
export function onMarketOverpricedQueueDrained(): void {
    const passFeedsRelists = getSetting(SETTING_RELIST_AUTOMATICALLY) == 1;

    if (passFeedsRelists && !marketListingsQueue.idle()) {
        refreshMarketOverpricedButtons();

        return;
    }

    resetMarketRelistProgress();
}

// The other half of the same rule: the pricing pass can finish after the last relist
// it queued is already done, and then nothing else is left to clear the progress.
export function onMarketListingsQueueDrained(): void {
    if (!marketOverpricedQueue.idle()) {
        return;
    }

    resetMarketRelistProgress();
}
