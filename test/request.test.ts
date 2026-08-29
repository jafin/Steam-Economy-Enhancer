import { test, beforeEach, afterEach, vi } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// request()'s own queueing, pending flag and breaker used to be untestable: the only seam
// was $.ajax, a real network call. transport is the adapter that fixes that - these tests
// give request() a fake one and a fake clock, and exercise the function itself rather than
// just the delay/breaker policy values it reads (see request-policy.test.js for those).

// A jQuery-ajax-shaped settings object in, one canned response out.
function respondWith(settings, response) {
    const xhr = { status: response.status ?? 200, responseText: response.responseText ?? '' };
    const statusText = response.statusText ?? (response.error ? 'error' : 'success');

    if (response.error) {
        settings.error(xhr, statusText, response.httpErrorText ?? '');
    } else {
        settings.success(response.data, statusText, xhr);
    }

    settings.complete(xhr, statusText);
}

// A transport that answers immediately, one scripted response per call.
function scriptedTransport(responses) {
    let next = 0;

    return (settings) => {
        respondWith(settings, responses[next++]);
    };
}

// A transport that holds each call open until the test resolves it, so a second request()
// made before the first completes can be observed queueing rather than sending.
function heldTransport() {
    const held = [];
    const transport = (settings) => held.push(settings);

    transport.respond = (index, response) => respondWith(held[index], response);
    transport.calls = held;

    return transport;
}

// vitest fake timers are global; without this they leak into the next test file.
afterEach(() => {
    vi.useRealTimers();
});

beforeEach(() => {
    // request.stopped is a deliberate one-way door within a process (see the "kept last"
    // test in request-policy.test.js) and is not reset here. Everything else is per-call
    // state that must not leak between tests in this file.
    see.request.pending = false;
    see.request.queue = [];
    see.request.errors = 0;
});

test('a successful request calls back with the transport\'s data', () => {
    vi.useFakeTimers();

    let result;
    see.request(
        'https://steamcommunity.com/',
        {},
        (err, data) => {
            result = [err, data];
        },
        { transport: scriptedTransport([{ data: { ok: true } }]) }
    );

    vi.advanceTimersByTime(0);

    assert.deepStrictEqual(result, [null, { ok: true }]);
});

test('a failed request calls back with an Error describing the status', () => {
    vi.useFakeTimers();

    let result;
    see.request(
        'https://steamcommunity.com/',
        { method: 'GET' },
        (err, data) => {
            result = [err, data];
        },
        { transport: scriptedTransport([{ error: true, status: 500 }]) }
    );

    vi.advanceTimersByTime(0);

    assert.ok(result[0] instanceof Error);
    assert.strictEqual(result[0].statusCode, 500);
    assert.strictEqual(result[1], null);
});

test('a request made while one is pending queues instead of sending', () => {
    vi.useFakeTimers();
    const transport = heldTransport();

    see.request('https://steamcommunity.com/first', {}, () => { }, { transport });
    see.request('https://steamcommunity.com/second', {}, () => { }, { transport });

    assert.strictEqual(transport.calls.length, 1, 'the second call is queued, not sent');
    assert.strictEqual(see.request.queue.length, 1);
});

test('the queued request is sent only after the first one\'s delay has passed', () => {
    vi.useFakeTimers();
    const transport = heldTransport();

    see.request('https://steamcommunity.com/first', {}, () => { }, { transport });
    see.request('https://steamcommunity.com/second', {}, () => { }, { transport });

    transport.respond(0, { data: 'first' });
    vi.advanceTimersByTime(0); // the success callback's own setTimeout(..., 0)

    assert.strictEqual(transport.calls.length, 1, 'not sent yet - the release delay has not passed');

    vi.advanceTimersByTime(see.requestPolicy.REQUEST_DELAY_DEFAULT);

    assert.strictEqual(transport.calls.length, 2, 'released once the default delay elapses');
});

test('a market request is released after the longer market delay, not the default one', () => {
    vi.useFakeTimers();
    const transport = heldTransport();

    see.request('https://steamcommunity.com/market/priceoverview', {}, () => { }, { transport });
    see.request('https://steamcommunity.com/market/second', {}, () => { }, { transport });

    transport.respond(0, { data: 'first' });
    vi.advanceTimersByTime(0);
    vi.advanceTimersByTime(see.requestPolicy.REQUEST_DELAY_DEFAULT);

    assert.strictEqual(transport.calls.length, 1, 'the default delay alone is not enough for a market URL');

    vi.advanceTimersByTime(see.requestPolicy.REQUEST_DELAY_MARKET - see.requestPolicy.REQUEST_DELAY_DEFAULT);

    assert.strictEqual(transport.calls.length, 2);
});

test('request() still works with no options object, for every existing call site', () => {
    // Existing callers pass request(url, options, callback) with no 4th argument, and must
    // keep working unchanged. The default transport is $.ajax, which the test harness stubs
    // as an inert no-op - this only proves the call does not throw before reaching it.
    assert.doesNotThrow(() => see.request('https://steamcommunity.com/', {}, () => { }));
});

// Kept last, like the equivalent test in request-policy.test.js: the breaker is a one-way
// door within this process, and every test above depends on request.errors starting at 0.
test('five broken responses in a row trip the breaker, through request() itself', () => {
    vi.useFakeTimers();

    const responses = Array.from({ length: 5 }, () => ({ error: true, status: 429 }));
    const transport = scriptedTransport(responses);

    assert.strictEqual(see.request.stopped, false);

    for (let i = 0; i < 5; i++) {
        see.request('https://steamcommunity.com/market/', {}, () => { }, { transport });
        vi.advanceTimersByTime(0); // the error callback's setTimeout(..., 0)
        vi.advanceTimersByTime(see.requestPolicy.REQUEST_DELAY_ERROR); // release the next one
    }

    assert.strictEqual(see.request.stopped, true, 'five 429s within the window trip it');

    let reported = null;
    see.request('https://steamcommunity.com/market/', {}, (err) => {
        reported = err;
    }, { transport });
    vi.advanceTimersByTime(1); // the stopped path's own setTimeout(..., 1)

    assert.ok(reported instanceof Error, 'a request made after tripping is refused, not sent');
    assert.match(reported.message, /Reload the page/);
});
