// Talking to Steam.
//
// One request at a time, with a delay between them, and a breaker that stops the script
// entirely when Steam starts answering with statuses that mean something is broken rather
// than merely busy. Everything the script fetches goes through here.

import $ from 'jquery';

import { logDOM } from '../ui/logger.ts';

// The single call request() makes to reach the network, injectable so tests can supply
// their own. Typed as "something that takes a jQuery-ajax-shaped settings object" rather
// than as $.ajax itself: inferring it from the default would demand jQuery's whole
// overloaded signature from every test double, which is precisely what the seam exists to
// avoid.
export type RequestTransport = (settings: any) => unknown;

// The Error request() passes to its callback on failure. The response detail is attached
// to the Error rather than passed alongside it, which is how every caller already reads it.
export interface RequestError extends Error {
    url: string;
    method?: string;
    errorText: string;
    statusCode: number;
    responseText: string;
}

// Rate policy. Market requests are slowed down to stay under Steam's rate limits, and
// anything that failed waits longer still.
export const REQUEST_DELAY_DEFAULT = 300;

export const REQUEST_DELAY_MARKET = 1000;

export const REQUEST_DELAY_ERROR = 5000;

export const REQUEST_MARKET_PREFIX = 'https://steamcommunity.com/market/';

// Breaker policy. These statuses mean something is broken rather than busy, so after
// enough of them within the window the script stops sending anything at all.
export const REQUEST_BREAKER_STATUSES = [400, 401, 403, 404, 405, 429];

export const REQUEST_BREAKER_THRESHOLD = 5;

export const REQUEST_BREAKER_WINDOW_MS = 5 * 60 * 1000;

export function getRequestStoppedMessage() {
    return `Steam Economy Enhancer stopped sending requests after ${
        REQUEST_BREAKER_THRESHOLD
    } failed requests within ${
        REQUEST_BREAKER_WINDOW_MS / 60000
    } minutes. Reload the page to start again.`;
}

// Trips once and stays tripped. Repeated 400/401/403/404/405/429 responses mean something
// is wrong that retrying will not fix, and hammering Steam after a rate limit makes it
// worse, so the stop is deliberate. Going quiet without saying so is not: announce it,
// because otherwise the script simply appears to stop working.
export function stopRequests() {
    request.stopped = true;
    request.errors = 0;

    console.error(getRequestStoppedMessage());
    logDOM(getRequestStoppedMessage());
}

// How long to wait before releasing the next queued request.
// A failure outranks the market delay, which outranks the default.
export function getRequestDelay(url, status, statusText) {
    if (status === 0 || status >= 400 || statusText === 'error') {
        return REQUEST_DELAY_ERROR;
    }

    if (url.startsWith(REQUEST_MARKET_PREFIX)) {
        return REQUEST_DELAY_MARKET;
    }

    return REQUEST_DELAY_DEFAULT;
}

export function request(
    url,
    options,
    callback,
    { transport = $.ajax }: { transport?: RequestTransport } = {},
) {
    callback = callback || function () {};

    // If the request was stopped, we don't want to send it to the server and continue other requests.
    if (request.stopped) {
        const error = new Error(getRequestStoppedMessage());

        setTimeout(() => request.queue.shift()?.(), 1);
        setTimeout(() => callback(error, null), 0);

        return;
    }

    // Add the request to the queue if another one is processing.
    if (request.pending) {
        const args = Array.prototype.slice.call(arguments);

        request.queue.push(() => request(...args));

        return;
    }

    request.pending = true;

    transport({
        url: url,

        type: options.method,

        data: options.data,

        dataType: options.responseType,

        /**
         *
         * @param {*} data - parsed response data, if the request was successful.
         * @param {string} statusText - one of `success`, `notmodified`, `nocontent`.
         * @param {XMLHttpRequest} xhr - XMLHttpRequest object with additional jQuery properties.
         */
        success: function (data, statusText, xhr) {
            setTimeout(() => callback(null, data), 0);
        },

        /**
         *
         * @param {XMLHttpRequest} xhr - XMLHttpRequest object with additional jQuery properties.
         * @param {string} statusText - one of `error`, `abort`, `timeout` or `parsererror`.
         * @param {string} httpErrorText - textual portion of the HTTP status, in context of HTTP/2 it may be empty string.
         */
        error: (xhr, statusText, httpErrorText) => {
            const error = new Error(
                `Request failed with status ${xhr.status || 0} (${statusText === 'error' ? 'http error' : statusText})`,
            ) as RequestError;

            error.url = url;
            error.method = options.method;
            error.errorText = statusText || '';
            error.statusCode = xhr.status || 0;
            error.responseText = xhr.responseText || '';

            setTimeout(() => callback(error, null), 0);
        },

        /**
         * @param {XMLHttpRequest} xhr - XMLHttpRequest object with additional jQuery properties.
         * @param {string} statusText - one of `success`, `notmodified`, `nocontent`, `error`, `timeout`, `abort`, or `parsererror`.
         */
        complete: (xhr, statusText) => {
            const delay = getRequestDelay(url, xhr.status, statusText);

            // Probably something broken, better to stop here.
            if (REQUEST_BREAKER_STATUSES.includes(xhr.status)) {
                if (request.errors++ === 0) {
                    setTimeout(() => (request.errors = 0), REQUEST_BREAKER_WINDOW_MS);
                }

                if (request.errors >= REQUEST_BREAKER_THRESHOLD) {
                    stopRequests();
                }
            }

            const next = () => {
                request.pending = false;
                request.queue.shift()?.();
            };

            setTimeout(next, delay);
        },
    });
}

export function isRetryMessage(message) {
    const messageList = [
        'You cannot sell any items until your previous action completes.',
        'There was a problem listing your item. Refresh the page and try again.',
        "We were unable to contact the game's item server. The game's item server may be down or Steam may be experiencing temporary connectivity issues. Your listing has not been created. Refresh the page and try again.",
    ];

    return messageList.indexOf(message) !== -1;
}

request.queue = [] as (() => void)[];
request.errors = 0;
request.pending = false;
request.stopped = false;
