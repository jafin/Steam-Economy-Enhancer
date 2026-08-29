// Queue backoff and retry.
//
// Every queue in this script -- selling, gems, boosters, market listings, relisting,
// removal -- needs the same two decisions after each task: how long to wait before the
// next one, and whether a failed task gets one more attempt. That logic used to be
// written out inline at each queue. It lives here now, and is pure given an explicit
// failure counter, which is what makes it testable without async.queue, a worker or a
// real clock.

import async from 'async';

import {
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
    RETRY_DELAY_SHORT_MAX,
    RETRY_DELAY_SHORT_MIN,
    RETRY_FAILURES_BEFORE_RESET,
} from '../constants.ts';
import { getRandomInt } from '../util/numbers.ts';

// A unit of work on one of the script's queues. The payload differs per queue -- a listing,
// an inventory item, a listing id -- and pinning those shapes is the item-shape question
// that outlives this migration, so the payload stays open. `ignoreErrors` is the one field
// runQueue itself owns: it sets it when re-pushing a task for its single forced retry.
export interface QueueTask {
    ignoreErrors?: boolean;
    [key: string]: any;
}

// Per-queue knobs. Every field is optional; the defaults are the ones nextQueueStep and
// runQueue apply when a queue passes nothing.
export interface RunQueueOptions {
    /** async.queue concurrency. Defaults to 1 -- these queues talk to Steam in series. */
    concurrency?: number;
    /** Delay after a successful task, or a function producing one. Defaults to a random short delay. */
    successDelayMs?: number | (() => number);
    /** Whether a failed task gets one more attempt with ignoreErrors forced on. */
    retryOnFailure?: boolean;
}

/** Backoff state for one queue. Mutable by design -- each queue owns exactly one. */
export interface FailureCounter {
    failures: number;
}

/** What a queue does after one task finishes. */
export interface QueueStep {
    /** Milliseconds to wait before starting the next task. */
    delay: number;
    /** Whether this task gets one more attempt with ignoreErrors forced on. */
    retry: boolean;
}

/**
 * Does the work for one task and reports back.
 *
 * A cached answer never reached Steam, so it is reported separately and left out of the
 * failure count and the delay entirely.
 */
export type QueueWorker = (
    task: QueueTask,
    ignoreErrors: boolean,
    callback: (success: boolean, cached?: boolean) => void,
) => void;

// Backoff state for one queue.
//
// The queues used to share a single module-level counter that only the inventory price
// queue ever incremented. The other three based their backoff on a number they could not
// raise, and reset it out from under the queue that could. Each queue now keeps its own.
export function createFailureCounter(): FailureCounter {
    return { failures: 0 };
}

// Records an item that came back from Steam without failing.
//
// Only a run of failures says anything about the connection, so a success ends the run.
// Without this the count only ever fell back to zero by overflowing the reset threshold,
// and two failures a hundred successful items apart still produced the long backoff.
export function resetRetryDelay(counter: FailureCounter): void {
    counter.failures = 0;
}

// Records a failed item and returns how long that queue waits before the next one.
// Back off hard after more than one failure in a row, then start counting again after
// more than three so a queue does not stay in the long delay forever.
export function nextRetryDelay(counter: FailureCounter): number {
    counter.failures += 1;

    const delay =
        counter.failures > 1
            ? getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX)
            : getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX);

    if (counter.failures > RETRY_FAILURES_BEFORE_RESET) {
        counter.failures = 0;
    }

    return delay;
}

// What a queue does after one task finishes: how long to wait before the next one, and
// whether this task gets one more try with ignoreErrors forced on before it is dropped.
//
// Pure given an explicit failure counter, so the backoff/retry decision itself is
// testable without async.queue, a worker or a real clock - the same reason
// nextRetryDelay/resetRetryDelay above take their counter as a parameter rather than
// closing over one.
export function nextQueueStep(
    success: boolean,
    // Undefined when a worker reports success without saying whether it was cached; the
    // two are treated the same way, so the callers that omit it are not wrong.
    cached: boolean | undefined,
    failures: FailureCounter,
    alreadyRetried: boolean,
    options: RunQueueOptions = {},
): QueueStep {
    if (success) {
        if (!cached) {
            resetRetryDelay(failures);
        }

        const configured =
            options.successDelayMs ??
            (() => getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));
        const delay = typeof configured === 'function' ? configured() : configured;

        return { delay: cached ? 0 : delay, retry: false };
    }

    const retry = (options.retryOnFailure ?? false) && !alreadyRetried;

    return { delay: cached ? 0 : nextRetryDelay(failures), retry };
}

// Wraps an async.queue with the escalating per-queue backoff every retrying queue in this
// file needs, and optionally a single forced-through retry: a task that failed once is
// pushed back onto the queue exactly once more with ignoreErrors forced true, matching
// the pattern the item and inventory-price queues already used by hand.
//
// worker(task, ignoreErrors, callback) does the actual work and reports back
// callback(success, cached). A cached answer never reached Steam, so - like the delay -
// it is left out of the failure count entirely.
//
// Returns the async.queue itself. push/kill/drain/length/idle all still work exactly as
// they did on a hand-rolled queue, so call sites that manage a queue's lifecycle do not
// need to change.
export function runQueue(worker: QueueWorker, options: RunQueueOptions = {}) {
    const failures = createFailureCounter();

    const queue = async.queue((task: QueueTask, next) => {
        worker(task, task.ignoreErrors === true, (success: boolean, cached?: boolean) => {
            const step = nextQueueStep(
                success,
                cached,
                failures,
                task.ignoreErrors === true,
                options,
            );

            if (step.retry) {
                task.ignoreErrors = true;
                queue.push(task);
            }

            setTimeout(() => next(), step.delay);
        });
    }, options.concurrency ?? 1);

    return queue;
}
