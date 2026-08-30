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

// Thin aliases over addWork/workDone, kept only until every call site is converted --
// TASK-06 step 5 removes them.
export function increaseMarketProgressMax(): void {
    addWork(1);
}

export function increaseMarketProgress(): void {
    workDone(1);
}

// The relist run is over, put the buttons back to showing the (now lower) overpriced count.
export function resetMarketRelistProgress() {
    marketProgress.relistTotal = 0;
    marketProgress.relistDone = 0;
    marketRelistQueuedListings.clear();

    refreshMarketOverpricedButtons();
}
