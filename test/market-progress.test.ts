// The market progress bar used to be two side-effecting nudges on a live <progress> element
// (increaseMarketProgressMax/increaseMarketProgress), so nothing could assert what it did
// without a page -- and the sell-listings pass raised the max once per batch while every
// queued listing raised the value by one, so value could run past max. addWork/workDone/
// progressState replace that pair with a plain counter this test can pin directly.

import { test } from 'vitest';
import assert from 'node:assert';
import {
    addWork,
    marketProgress,
    onMarketOverpricedQueueDrained,
    progressState,
    workDone,
} from '../src/market/progress.ts';
import { marketListingsQueue } from '../src/market/listings.ts';
import { SETTING_RELIST_AUTOMATICALLY, setSetting } from '../src/settings/index.ts';

test("workDone tracks addWork's total and does not run past it", () => {
    addWork(5);
    workDone();
    workDone();
    workDone();
    workDone();
    workDone();

    assert.deepStrictEqual(progressState(), { total: 5, done: 5 });

    // Regression pin: a sixth completion must not push done past total -- this is the
    // off-by-N the old interface could not guard against, since nothing could read its
    // state back without a live <progress> element.
    workDone();

    assert.deepStrictEqual(progressState(), { total: 5, done: 5 });
});

// The relist queue's drain policy.
//
// While the pricing pass is running it may be feeding the relist queue itself, so a relist
// queue that drains mid-pass has not necessarily finished the run -- clearing the progress
// there would restart the count from zero part way through. That is only true when automatic
// relisting is on. With it off the pass will never queue a relist, so a user who clicks
// "Relist overpriced" mid-scan gets a run that is over when the queue drains, and the button
// must go back to its count rather than staying stuck at N/N and disabled.

test('a manual relist run ends when its queue drains, even mid pricing pass', () => {
    localStorage.clear();
    setSetting(SETTING_RELIST_AUTOMATICALLY, 0);

    // The pricing pass has work outstanding. Pushed and killed without turning the event
    // loop, so the real worker never runs -- only idle() is under test here.
    marketListingsQueue.push({});

    try {
        marketProgress.relistTotal = 1;
        marketProgress.relistDone = 1;

        onMarketOverpricedQueueDrained();

        assert.deepStrictEqual(
            { relistTotal: marketProgress.relistTotal, relistDone: marketProgress.relistDone },
            { relistTotal: 0, relistDone: 0 },
        );
    } finally {
        marketListingsQueue.kill();
    }
});

test('automatic relisting keeps the progress while the pass can still feed the queue', () => {
    localStorage.clear();
    setSetting(SETTING_RELIST_AUTOMATICALLY, 1);

    marketListingsQueue.push({});

    try {
        marketProgress.relistTotal = 3;
        marketProgress.relistDone = 3;

        onMarketOverpricedQueueDrained();

        assert.deepStrictEqual(
            { relistTotal: marketProgress.relistTotal, relistDone: marketProgress.relistDone },
            { relistTotal: 3, relistDone: 3 },
        );
    } finally {
        marketListingsQueue.kill();
        localStorage.clear();
    }
});
