import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

afterEach(() => {
    vi.useRealTimers();
});

// Runs a queue to completion on a fake clock. The delays between tasks are seconds long by
// design, so waiting them out for real would put minutes on the suite.
async function drain(queue: any) {
    await vi.advanceTimersByTimeAsync(120000);

    assert.strictEqual(queue.length(), 0, 'queue did not drain');
}

const SHORT = [1000, 1500];
const LONG = [30000, 45000];

function assertWithin(value: number, [min, max]: number[], what: string) {
    assert.ok(
        value >= min && value <= max,
        `${what}: expected ${value} to be within ${min}-${max}`,
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

// The two options below are runQueue's, not nextQueueStep's, so these drive real tasks
// through a real async.queue rather than testing the decision in isolation.

test('onTaskDone reports a task once, when it succeeds first time', async () => {
    vi.useFakeTimers();

    const done: any[] = [];
    const worker = (_task: any, _ignoreErrors: boolean, cb: any) => cb(true);

    const queue = see.runQueue(worker, {
        successDelayMs: 0,
        onTaskDone: (task: any, success: boolean) => done.push([task.id, success]),
    });

    queue.push({ id: 'a' });
    queue.push({ id: 'b' });
    await drain(queue);

    assert.deepStrictEqual(done, [
        ['a', true],
        ['b', true],
    ]);
});

test('onTaskDone reports a retried task once, not once per attempt', async () => {
    // The market queues counted progress in the callback they handed to the retry, so a
    // retried listing advanced the bar once however many attempts it took. Firing this hook
    // per attempt instead would count it twice and run the bar past its own total.
    vi.useFakeTimers();

    const done: any[] = [];
    let attempts = 0;

    const worker = (_task: any, _ignoreErrors: boolean, cb: any) => {
        attempts += 1;
        cb(attempts > 1);
    };

    const queue = see.runQueue(worker, {
        retryOnFailure: true,
        successDelayMs: 0,
        onTaskDone: (task: any, success: boolean) => done.push([task.id, success]),
    });

    queue.push({ id: 'a' });
    await drain(queue);

    assert.strictEqual(attempts, 2, 'failed once, retried once');
    assert.deepStrictEqual(done, [['a', true]]);
});

test('onTaskDone reports a task that fails and is not retried', async () => {
    vi.useFakeTimers();

    const done: any[] = [];
    const worker = (_task: any, _ignoreErrors: boolean, cb: any) => cb(false);

    const queue = see.runQueue(worker, {
        onTaskDone: (task: any, success: boolean) => done.push([task.id, success]),
    });

    queue.push({ id: 'a' });
    await drain(queue);

    assert.deepStrictEqual(done, [['a', false]]);
});

test('a retry goes to the back of the queue by default', async () => {
    vi.useFakeTimers();

    const started: string[] = [];
    const worker = (task: any, ignoreErrors: boolean, cb: any) => {
        started.push(task.id);
        cb(ignoreErrors || task.id !== 'a');
    };

    const queue = see.runQueue(worker, { retryOnFailure: true, successDelayMs: 0 });

    queue.push({ id: 'a' });
    queue.push({ id: 'b' });
    queue.push({ id: 'c' });
    await drain(queue);

    assert.deepStrictEqual(started, ['a', 'b', 'c', 'a']);
});

test("retryPlacement 'front' puts the retry ahead of work already queued", async () => {
    // For relist the task is holding something open: the listing is already removed, so an
    // item whose retry waits behind the rest of the run stays unlisted for all of it.
    vi.useFakeTimers();

    const started: string[] = [];
    const worker = (task: any, ignoreErrors: boolean, cb: any) => {
        started.push(task.id);
        cb(ignoreErrors || task.id !== 'a');
    };

    const queue = see.runQueue(worker, {
        retryOnFailure: true,
        successDelayMs: 0,
        retryPlacement: 'front',
    });

    queue.push({ id: 'a' });
    queue.push({ id: 'b' });
    queue.push({ id: 'c' });
    await drain(queue);

    assert.deepStrictEqual(started, ['a', 'a', 'b', 'c']);
});

test('runQueue returns a queue-shaped object without touching the network', () => {
    const worker = () => {
        throw new Error(
            'the fake async.queue must not invoke the worker just by constructing the queue',
        );
    };

    const queue = see.runQueue(worker, {});

    assert.strictEqual(typeof queue.push, 'function');
    assert.strictEqual(typeof queue.drain, 'function');
});
