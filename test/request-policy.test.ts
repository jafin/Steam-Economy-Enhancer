import { test, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

const policy = see.requestPolicy;

const MARKET_URL = 'https://steamcommunity.com/market/priceoverview/';
const OTHER_URL = 'https://steamcommunity.com/id/test/inventory/json/';

afterEach(() => {
    vi.restoreAllMocks();
});

test('an ordinary request waits the default delay', () => {
    assert.strictEqual(
        see.getRequestDelay(OTHER_URL, 200, 'success'),
        policy.REQUEST_DELAY_DEFAULT
    );
});

test('a market request waits longer, to stay under Steam rate limits', () => {
    assert.strictEqual(
        see.getRequestDelay(MARKET_URL, 200, 'success'),
        policy.REQUEST_DELAY_MARKET
    );
    assert.ok(policy.REQUEST_DELAY_MARKET > policy.REQUEST_DELAY_DEFAULT);
});

test('a failure outranks the market delay', () => {
    // Ordering matters: the original code applied the market delay first and let the error
    // delay overwrite it. Both URLs must back off by the error delay.
    assert.strictEqual(
        see.getRequestDelay(MARKET_URL, 429, 'error'),
        policy.REQUEST_DELAY_ERROR
    );
    assert.strictEqual(
        see.getRequestDelay(OTHER_URL, 500, 'error'),
        policy.REQUEST_DELAY_ERROR
    );
});

test('a status of 0, meaning no response at all, counts as a failure', () => {
    assert.strictEqual(
        see.getRequestDelay(OTHER_URL, 0, 'success'),
        policy.REQUEST_DELAY_ERROR
    );
});

test('statusText alone is enough to trigger the error delay', () => {
    assert.strictEqual(
        see.getRequestDelay(OTHER_URL, 200, 'error'),
        policy.REQUEST_DELAY_ERROR
    );
});

test('the breaker watches the statuses that mean broken rather than busy', () => {
    for (const status of [
        400,
        401,
        403,
        404,
        405,
        429
    ]) {
        assert.ok(
            policy.REQUEST_BREAKER_STATUSES.includes(status),
            `expected ${status} to trip the breaker`
        );
    }

    assert.ok(!policy.REQUEST_BREAKER_STATUSES.includes(200));
    assert.ok(
        !policy.REQUEST_BREAKER_STATUSES.includes(500),
        'a server error is treated as busy, not broken'
    );
});

test('the breaker thresholds are the documented five errors in five minutes', () => {
    assert.strictEqual(policy.REQUEST_BREAKER_THRESHOLD, 5);
    assert.strictEqual(policy.REQUEST_BREAKER_WINDOW_MS, 5 * 60 * 1000);
});

test('the stopped message names the thresholds and says how to recover', () => {
    const message = see.getRequestStoppedMessage();

    assert.match(message, /5 failed requests/);
    assert.match(message, /5 minutes/);
    assert.match(message, /Reload the page/);
});

// Kept last: tripping the breaker is a one-way door within this process.
// node --test gives each file its own process, so no other test file is affected.
test('tripping the breaker announces itself and tells callers why', () => {
    const reportedToConsole = [];

    vi.spyOn(console, 'error').mockImplementation((msg) => {
        reportedToConsole.push(msg);
    });

    assert.strictEqual(see.request.stopped, false, 'starts un-tripped');

    // The announcement goes to the on-page log, which only exists on the inventory page.
    // Anywhere else there is nothing to write to, and the breaker used to throw on the way
    // out: the caller never rescheduled the queue and the request stayed pending forever.
    assert.doesNotThrow(() => see.stopRequests(), 'announcing works without the page log');

    assert.strictEqual(see.request.stopped, true, 'stays stopped, by design');
    assert.strictEqual(see.request.errors, 0);
    assert.strictEqual(reportedToConsole.length, 1, 'the stop is announced, not silent');
    assert.match(reportedToConsole[0], /Reload the page/);

    let reported = null;
    see.request('https://steamcommunity.com/market/', {}, (err) => {
        reported = err;
    });

    return new Promise((resolve) => {
        setTimeout(() => {
            assert.ok(reported instanceof Error, 'the caller is told, not left waiting');
            assert.match(reported.message, /Reload the page/);
            resolve();
        }, 10);
    });
});
