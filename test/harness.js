'use strict';

// Loads code.user.js under Node.
//
// The userscript is one IIFE that runs a lot of work at load time: it reads six Steam
// globals, constructs `market`, creates two localforage instances (clearing one), builds a
// detached logger element and injects a stylesheet. None of that is guarded, so the file
// cannot simply be required.
//
// The stubs below are deliberately explicit rather than clever. The list is documentation of
// exactly how much global state this file needs before a single pure function can be called.

const path = require('path');

// A callable, endlessly chainable no-op stand-in for a jQuery object.
function chainable() {
    const target = function () {
        return target;
    };

    return new Proxy(target, {
        get(_, prop) {
            if (prop === 'length') {
                return 0;
            }

            if (prop === Symbol.toPrimitive || prop === 'toString') {
                return () => '';
            }

            if (prop === 'get') {
                return () => [];
            }

            return () => chainable();
        },
        apply() {
            return chainable();
        }
    });
}

function fakeJQuery() {
    const $ = function () {
        return chainable();
    };

    $.noConflict = () => $;
    $.ajax = () => chainable();
    $.extend = Object.assign;
    $.fn = {}; // the script installs its own plugins on this at load

    return $;
}

function fakeAsync() {
    return {
        queue() {
            const q = {
                push() { },
                drain() { },
                length: () => 0,
                running: () => 0,
                idle: () => true,
                pause() { },
                resume() { },
                unshift() { }
            };

            return q;
        }
    };
}

function fakeStorage() {
    const map = new Map();

    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => map.set(k, String(v)),
        removeItem: (k) => map.delete(k),
        clear: () => map.clear()
    };
}

function fakeLocalforage() {
    return {
        createInstance() {
            return {
                getItem: () => Promise.resolve(null),
                setItem: () => Promise.resolve(),
                clear: () => Promise.resolve(),
                removeItem: () => Promise.resolve()
            };
        }
    };
}

function fakeElement() {
    return {
        setAttribute() { },
        appendChild() { },
        getElementsByTagName: () => [fakeElement()],
        style: {},
        innerHTML: '',
        scrollTop: 0,
        scrollHeight: 0,
        clientHeight: 0
    };
}

function fakeDocument() {
    return {
        createElement: () => fakeElement(),
        // The logger scrolls itself by looking itself up by id, so this must not be null.
        getElementById: () => fakeElement(),
        querySelector: () => null,
        querySelectorAll: () => [],
        getElementsByTagName: () => [fakeElement()],
        cookie: '',
        addEventListener() { }
    };
}

// Steam's page globals. Wallet info is a real-looking EUR wallet so the fee maths has
// something to work with; tests that care pass their own values in explicitly.
function fakeUnsafeWindow() {
    return {
        g_strCountryCode: 'NL',
        g_bLoggedIn: true,
        g_rgWalletInfo: {
            wallet_currency: 3,
            wallet_country: 'NL',
            wallet_fee_base: 0,
            wallet_fee_percent: 0.05,
            wallet_fee_minimum: 1,
            wallet_publisher_fee_percent_default: 0.10,
            wallet_max_balance: 200000,
            wallet_trade_max_balance: 180000
        },
        g_rgAppContextData: {},
        g_strInventoryLoadURL: 'https://steamcommunity.com/id/test/inventory/json/',
        g_rgAssets: {},
        GetCurrencyCode: () => 'EUR',
        GetPriceValueAsInt: (s) => Math.round(parseFloat(String(s).replace(',', '.')) * 100) || 0,
        v_currencyformat: (v) => String(v)
    };
}

let cached = null;

// Loads the userscript once and returns whatever its guarded export tail exposes.
function loadUserscript() {
    if (cached) {
        return cached;
    }

    const url = 'https://steamcommunity.com/market/';

    globalThis.unsafeWindow = fakeUnsafeWindow();
    globalThis.window = { location: { href: url, origin: 'https://steamcommunity.com' } };
    globalThis.document = fakeDocument();
    globalThis.localStorage = fakeStorage();
    globalThis.sessionStorage = fakeStorage();
    globalThis.jQuery = fakeJQuery();
    globalThis.async = fakeAsync();
    globalThis.localforage = fakeLocalforage();
    globalThis.luxon = { DateTime: { now: () => ({ toMillis: () => 0 }) } };
    globalThis.List = function () { };

    cached = require(path.join(__dirname, '..', 'code.user.js'));

    return cached;
}

module.exports = { loadUserscript };
