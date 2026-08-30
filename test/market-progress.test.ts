// The market progress bar used to be two side-effecting nudges on a live <progress> element
// (increaseMarketProgressMax/increaseMarketProgress), so nothing could assert what it did
// without a page -- and the sell-listings pass raised the max once per batch while every
// queued listing raised the value by one, so value could run past max. addWork/workDone/
// progressState replace that pair with a plain counter this test can pin directly.

import { test } from 'vitest';
import assert from 'node:assert';
import { addWork, progressState, workDone } from '../src/market/progress.ts';

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
