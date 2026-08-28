'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadUserscript } = require('./harness.js');

const see = loadUserscript();

const SHORT = [
    1000,
    1500
];
const LONG = [
    30000,
    45000
];

function assertWithin(value, [min, max], what) {
    assert.ok(
        value >= min && value <= max,
        `${what}: expected ${value} to be within ${min}-${max}`
    );
}

// nextQueueStep is the decision every hand-rolled queue in this file used to make inline:
// how long to wait before the next task, and whether a failed one gets one more try. Pure
// given an explicit failure counter, so it is tested directly - no async.queue, no worker,
// no real clock.

test('a success schedules the default short delay and resets the failure count', () => {
    const failures = see.createFailureCounter();
    see.nextRetryDelay(failures); // one prior failure, so a bare reset would be visible

    const step = see.nextQueueStep(true, false, failures, false, {});

    assertWithin(step.delay, SHORT, 'success delay');
    assert.strictEqual(step.retry, false);
    assert.strictEqual(failures.failures, 0, 'a real success ends the run');
});

test('a cached success has no delay and does not touch the failure count', () => {
    // A cached answer never reached Steam, so it says nothing about the connection either
    // way - see the comment on the item and inventory-price queues this replaces.
    const failures = see.createFailureCounter();
    see.nextRetryDelay(failures);

    const step = see.nextQueueStep(true, true, failures, false, {});

    assert.strictEqual(step.delay, 0);
    assert.strictEqual(step.retry, false);
    assert.strictEqual(failures.failures, 1, 'left exactly as the prior failure set it');
});

test('successDelayMs can be a fixed number, for queues with no jitter', () => {
    const failures = see.createFailureCounter();

    const step = see.nextQueueStep(true, false, failures, false, { successDelayMs: 250 });

    assert.strictEqual(step.delay, 250);
});

test('successDelayMs can be a function, for queues with jitter', () => {
    const failures = see.createFailureCounter();
    let calls = 0;
    const successDelayMs = () => {
        calls += 1;
        return 42;
    };

    const step = see.nextQueueStep(true, false, failures, false, { successDelayMs });

    assert.strictEqual(step.delay, 42);
    assert.strictEqual(calls, 1);
});

test('a failure backs off through the shared escalating counter and does not retry by default', () => {
    const failures = see.createFailureCounter();

    const step = see.nextQueueStep(false, false, failures, false, {});

    assertWithin(step.delay, SHORT, 'first failure');
    assert.strictEqual(step.retry, false);
    assert.strictEqual(failures.failures, 1);
});

test('a cached failure has no delay and does not advance the failure count', () => {
    const failures = see.createFailureCounter();

    const step = see.nextQueueStep(false, true, failures, false, {});

    assert.strictEqual(step.delay, 0);
    assert.strictEqual(failures.failures, 0, 'never reached Steam, so it is not a real failure');
});

test('retryOnFailure asks for one more try, forcing ignoreErrors, the first time a task fails', () => {
    const failures = see.createFailureCounter();

    const step = see.nextQueueStep(false, false, failures, false, { retryOnFailure: true });

    assert.strictEqual(step.retry, true);
});

test('retryOnFailure does not ask for a second retry - a task only gets one', () => {
    const failures = see.createFailureCounter();

    const step = see.nextQueueStep(false, false, failures, true, { retryOnFailure: true });

    assert.strictEqual(step.retry, false);
});

test('a second failure in a row still backs off hard even with retryOnFailure set', () => {
    const failures = see.createFailureCounter();

    see.nextQueueStep(false, false, failures, false, { retryOnFailure: true });
    const second = see.nextQueueStep(false, false, failures, true, { retryOnFailure: true });

    assertWithin(second.delay, LONG, 'second failure in a row');
});

test('runQueue returns a queue-shaped object without touching the network', () => {
    const worker = () => {
        throw new Error('the fake async.queue must not invoke the worker just by constructing the queue');
    };

    const queue = see.runQueue(worker, {});

    assert.strictEqual(typeof queue.push, 'function');
    assert.strictEqual(typeof queue.drain, 'function');
});
