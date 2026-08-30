// The run totals used to be five exported `let`-like fields nothing ever reset -- see
// src/totals.ts. This guards the fix: endRun() must zero every counter, and every mutation
// must go through the named verbs rather than a field write nothing else can see.

import { test } from 'vitest';
import assert from 'node:assert';
import { endRun, processed, queued, runTotals } from '../src/totals.ts';

test('endRun resets every counter back to zero', () => {
    queued(3);
    processed();
    processed();
    processed();
    endRun();

    assert.deepStrictEqual(runTotals(), {
        processedQueueItems: 0,
        queuedItems: 0,
        priceWithFeesOnMarket: 0,
        priceWithoutFeesOnMarket: 0,
        scrap: 0,
    });
});
