import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

const SHORT = [1000, 1500];
const LONG = [30000, 45000];

function assertWithin(value, [min, max], what) {
    assert.ok(
        value >= min && value <= max,
        `${what}: expected ${value} to be within ${min}-${max}`,
    );
}

test('the first failure backs off briefly', () => {
    const counter = see.createFailureCounter();

    assertWithin(see.nextRetryDelay(counter), SHORT, 'first failure');
    assert.strictEqual(counter.failures, 1);
});

test('a second failure in a row backs off hard', () => {
    const counter = see.createFailureCounter();

    see.nextRetryDelay(counter);
    assertWithin(see.nextRetryDelay(counter), LONG, 'second failure');
    assert.strictEqual(counter.failures, 2);
});

test('the count restarts after more than three failures', () => {
    const counter = see.createFailureCounter();

    for (let i = 0; i < 4; i++) {
        see.nextRetryDelay(counter);
    }

    assert.strictEqual(counter.failures, 0, 'reset so it does not back off forever');
    assertWithin(see.nextRetryDelay(counter), SHORT, 'first failure after the reset');
});

test('a success ends the run, so the next failure is a first failure again', () => {
    // The backoff is for failures in a row. The count used to fall back to zero only by
    // overflowing the reset threshold, so two failures a hundred good items apart still
    // waited 30-45 seconds.
    const counter = see.createFailureCounter();

    see.nextRetryDelay(counter);
    see.resetRetryDelay(counter);

    assert.strictEqual(counter.failures, 0);
    assertWithin(see.nextRetryDelay(counter), SHORT, 'first failure after a success');
});

test('a success part way through a run stops the hard backoff', () => {
    const counter = see.createFailureCounter();

    see.nextRetryDelay(counter);
    assertWithin(see.nextRetryDelay(counter), LONG, 'two in a row');

    see.resetRetryDelay(counter);

    assertWithin(see.nextRetryDelay(counter), SHORT, 'the run was broken by a success');
});

test('counters are independent, so one queue cannot back off another', () => {
    // This is the defect this change fixes. numberOfFailedRequests was a single
    // module-level counter incremented only by the inventory price queue, while the scrap,
    // booster and item queues read it and reset it. A queue could be pushed into a 30-45
    // second delay by failures it never saw, and could clear another queue's state.
    const scrap = see.createFailureCounter();
    const booster = see.createFailureCounter();

    see.nextRetryDelay(scrap);
    see.nextRetryDelay(scrap);

    assert.strictEqual(scrap.failures, 2);
    assert.strictEqual(booster.failures, 0, 'untouched by the other queue');

    assertWithin(see.nextRetryDelay(booster), SHORT, 'booster still on its first failure');
});
