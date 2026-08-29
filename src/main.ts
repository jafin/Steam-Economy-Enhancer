// Steam Economy Enhancer -- script body.
//
// Ported verbatim from the single-IIFE code.user.js. The userscript metadata block now
// lives in userscript.config.ts, and the jQuery/async/localforage/luxon/list.js globals
// that were IIFE parameters or bare @require globals are imports, mapped back to those
// same window globals at build time by vite-plugin-monkey's externalGlobals. That mapping
// is what makes $.noConflict(true) below safe: the bundler captures jQuery into a local
// binding before this module body runs, exactly as the IIFE parameter used to.
//
// The module.exports test seam that used to sit at the foot of the file is gone; the same
// names are real ES exports now. Nothing in the userscript entry path imports them, so
// they are tree-shaken out of the built artifact.

import $ from 'jquery';
import async from 'async';
import localforage from 'localforage';
import * as luxon from 'luxon';
import List from 'list.js';

import {
    COLOR_ERROR,
    COLOR_PENDING,
    COLOR_PRICE_CHEAP,
    COLOR_PRICE_EXPENSIVE,
    COLOR_PRICE_FAIR,
    COLOR_PRICE_NOT_CHECKED,
    COLOR_SUCCESS,
    enableConsoleLog,
    ERROR_DATA,
    ERROR_FAILED,
    ERROR_SUCCESS,
    PAGE_INVENTORY,
    PAGE_MARKET,
    PAGE_MARKET_LISTING,
    PAGE_TRADEOFFER,
    RETRY_DELAY_LONG_MAX,
    RETRY_DELAY_LONG_MIN,
    RETRY_DELAY_SHORT_MAX,
    RETRY_DELAY_SHORT_MIN,
    RETRY_FAILURES_BEFORE_RESET,
    ROW_STATUS_COLORS,
    VERDICT_COLORS,
    VERDICT_FAIR,
    VERDICT_MESSAGES,
    VERDICT_OVERPRICED,
    VERDICT_UNDERPRICED,
} from './constants.ts';

// Vendored jQuery plugins, previously @require'd from raw.githubusercontent.com. Both
// attach to the jQuery global at evaluation time, which -- because ES imports are
// evaluated before the module body -- is still before $.noConflict(true) runs below.
import './vendor/jquery-observe.js';
import './vendor/jquery.checkboxes.js';

$.noConflict(true);

// Colours an inventory row by asset key - the same `appid_contextid_assetid` id every
// inventory item element carries (see getAssetKey, below). Replaces nine identical
// `$('#'+appid+'_'+contextid+'_'+itemId).css('background', COLOR_X)` sites that only
// ever differed in which COLOR_* they painted.
function markRow(assetKey, status) {
    $(`#${assetKey}`).css('background', ROW_STATUS_COLORS[status]);
}

const marketLists: any[] = [];
let totalNumberOfProcessedQueueItems = 0;
let totalNumberOfQueuedItems = 0;
let totalPriceWithFeesOnMarket = 0;
let totalPriceWithoutFeesOnMarket = 0;
let totalScrap = 0;

// Everything Steam's own page exposes, in one place. `unsafeWindow` global reach-ins used
// to happen at ~44 sites across the whole file: this is what caused the bug fixed in
// PR #334, where Steam changed which DOM element the sell listings' header actually was
// and `$('.my_market_header').first()` silently grabbed the wrong one. Nothing failed;
// the Relist/Select buttons just stopped appearing.
//
// createSteamPage(win) is the live adapter, built once from unsafeWindow at load time.
// A second, fixture adapter (createFixtureSteamPage, in test/steam-page-fixture.js)
// implements the same shape from data instead of a real page, so a change to the shape
// this file expects Steam's page to have can be caught by a test rather than by a user
// reporting silence. See test/steam-page.test.js.

// The rule PR #334 needed, pulled out of the DOM lookup that feeds it: prefer the header
// anchored to the sell listings table itself, and only fall back to "whichever header
// is first" when the anchored lookup truly finds nothing. `anchored`/`all` need only
// `.length` and index access, so this runs the same whether they came from a real
// jQuery selection or plain fixture data - see test/steam-page-fixture.js.
function pickSellListingsHeader(anchored, all) {
    return anchored.length > 0 ? anchored[0] : all[0];
}

function createSteamPage(win) {
    return {
        // Session / config
        isLoggedIn: () =>
            (typeof win.g_rgWalletInfo !== 'undefined' && win.g_rgWalletInfo != null) ||
            (typeof win.g_bLoggedIn !== 'undefined' && win.g_bLoggedIn),
        countryCode: () =>
            typeof win.g_strCountryCode !== 'undefined' ? win.g_strCountryCode : undefined,
        walletInfo: () => win.g_rgWalletInfo,
        appContextData: () => win.g_rgAppContextData,
        inventoryLoadUrl: () => win.g_strInventoryLoadURL || undefined,
        profileUrl: () => win.g_strProfileURL || undefined,
        currencyCode: (currencyId) => win.GetCurrencyCode(currencyId),
        formatPrice: (valueInCents, currencyCode, currencyCountry) =>
            win.v_currencyformat(valueInCents, currencyCode, currencyCountry),
        parsePriceText: (text) => win.GetPriceValueAsInt(text),
        showDialog: (title, html) => win.ShowDialog(title, html),
        showConfirmDialog: (title, html) => win.ShowConfirmDialog(title, html),

        // Inventory
        activeInventory: () => win.g_ActiveInventory,
        activeUser: () => win.g_ActiveUser,
        steamId: () => win.g_steamID,
        activeSelectView: () => win.iActiveSelectView,

        // Patches CInventory.prototype.SelectItem to also call handler(rgItem) after
        // Steam's own selection handling, and returns a teardown that restores the
        // original. A no-op, reversible teardown if CInventory never loaded.
        onInventorySelectItem(handler) {
            if (typeof win.CInventory === 'undefined') {
                return () => {};
            }

            const original = win.CInventory.prototype.SelectItem;

            win.CInventory.prototype.SelectItem = function (event, elItem, rgItem) {
                original.apply(this, arguments);
                handler(rgItem);
            };

            return () => {
                win.CInventory.prototype.SelectItem = original;
            };
        },

        // Market assets
        assetFor: (appid, contextid, assetid) => win.g_rgAssets?.[appid]?.[contextid]?.[assetid],
        setAsset: (appid, contextid, assetid, asset) => {
            win.g_rgAssets[appid][contextid][assetid] = asset;
        },

        // There is only one item in g_rgAssets on a market listing page - the first (and
        // only) leaf this finds, whatever its appid/contextid/assetid.
        firstAsset: () => {
            for (const appid in win.g_rgAssets) {
                for (const contextid in win.g_rgAssets[appid]) {
                    for (const assetid in win.g_rgAssets[appid][contextid]) {
                        return win.g_rgAssets[appid][contextid][assetid];
                    }
                }
            }

            return null;
        },

        mergeAssets: (assets) => win.MergeWithAssetArray(assets),
        requestFullInventory: (url, callback) =>
            win.RequestFullInventory(url, {}, null, null, callback),
        myListingsTotalCount: () =>
            typeof win.g_oMyListings !== 'undefined' && win.g_oMyListings != null
                ? win.g_oMyListings.m_cTotalCount
                : null,
        goToHistoryPage: (index) => {
            if (typeof win.g_oMyHistory !== 'undefined') {
                win.g_oMyHistory.GoToPage(index);
            }
        },

        // The header the sell listings buttons attach to. See pickSellListingsHeader.
        sellListingsHeader: () => {
            const anchored = $('#tabContentsMyActiveMarketListingsRows')
                .closest('.market_home_listing_table')
                .find('.my_market_header');
            const all = $('.my_market_header');

            return $(pickSellListingsHeader(anchored, all));
        },

        // Trade offer. `side` is 'me' or 'them', the same keys g_rgCurrentTradeStatus
        // itself uses, so both sides of a trade can be walked with one loop over
        // ['me', 'them'] instead of the same code written out twice.
        tradeAssets: (side) => win.g_rgCurrentTradeStatus[side].assets,
        findTradeAsset: (side, appid, contextid, assetid) => {
            const user = side === 'me' ? win.UserYou : win.UserThem;

            return user.findAsset(appid, contextid, assetid);
        },
        moveItemToTrade: (item) => win.MoveItemToTrade(item),
    };
}

const steamPage = createSteamPage(unsafeWindow);

const country = steamPage.countryCode();
const isLoggedIn = steamPage.isLoggedIn();

const currentPage = window.location.href.includes('.com/market')
    ? window.location.href.includes('market/listings')
        ? PAGE_MARKET_LISTING
        : PAGE_MARKET
    : window.location.href.includes('.com/tradeoffer')
      ? PAGE_TRADEOFFER
      : PAGE_INVENTORY;

const market = new SteamMarket(
    steamPage.appContextData(),
    getInventoryUrl(),
    isLoggedIn ? steamPage.walletInfo() : undefined,
);

const currencyId =
    isLoggedIn &&
    market != null &&
    market.walletInfo != null &&
    market.walletInfo.wallet_currency != null
        ? market.walletInfo.wallet_currency
        : 3;

const currencyCountry =
    isLoggedIn &&
    market != null &&
    market.walletInfo != null &&
    market.walletInfo.wallet_country != null
        ? market.walletInfo.wallet_country
        : 'US';

const currencyCode = steamPage.currencyCode(currencyId);

// Currencies affected by the December 2025 Steam Market rule changes.
// These currencies use round instead of floor.
// Reference: https://steamcommunity.com/groups/community_market/discussions/0/682988196226679356
// Alternative approach: Check currency code instead of ID for better reliability
const CURRENCY_CODES_TO_ROUND = [
    'JPY', // Japanese Yen (unit: 1)
    'IDR', // Indonesian Rupiah (unit: 1)
    'UAH', // Ukrainian Hryvnia (unit: 1)
    'CLP', // Chilean Peso (unit: 1)
    'COP', // Colombian Peso (unit: 1)
    'TWD', // New Taiwan Dollar (unit: 1)
    'KZT', // Kazakhstani Tenge (unit: 1)
    'CRC', // Costa Rican Colón (unit: 5)
    'UYU', // Uruguayan Peso (unit: 1)
    'KRW', // South Korean Won (unit: 10)
    'VND', // Vietnamese Dong (unit: 500)
];

// Check if the current currency uses round for fees.
const useRound = CURRENCY_CODES_TO_ROUND.includes(currencyCode);

function SteamMarket(this: any, appContext, inventoryUrl, walletInfo) {
    this.appContext = appContext;
    this.inventoryUrl = inventoryUrl;
    this.walletInfo = walletInfo;
    this.inventoryUrlBase = inventoryUrl.replace('/inventory/json', '');
    if (!this.inventoryUrlBase.endsWith('/')) {
        this.inventoryUrlBase += '/';
    }
}

request.queue = [] as (() => void)[];
request.errors = 0;
request.pending = false;
request.stopped = false;

// Rate policy. Market requests are slowed down to stay under Steam's rate limits, and
// anything that failed waits longer still.
const REQUEST_DELAY_DEFAULT = 300;
const REQUEST_DELAY_MARKET = 1000;
const REQUEST_DELAY_ERROR = 5000;
const REQUEST_MARKET_PREFIX = 'https://steamcommunity.com/market/';

// Breaker policy. These statuses mean something is broken rather than busy, so after
// enough of them within the window the script stops sending anything at all.
const REQUEST_BREAKER_STATUSES = [400, 401, 403, 404, 405, 429];
const REQUEST_BREAKER_THRESHOLD = 5;
const REQUEST_BREAKER_WINDOW_MS = 5 * 60 * 1000;

// The Error request() passes to its callback on failure. The response detail is attached
// to the Error rather than passed alongside it, which is how every caller already reads it.
interface RequestError extends Error {
    url: string;
    method?: string;
    errorText: string;
    statusCode: number;
    responseText: string;
}

function getRequestStoppedMessage() {
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
function stopRequests() {
    request.stopped = true;
    request.errors = 0;

    console.error(getRequestStoppedMessage());
    logDOM(getRequestStoppedMessage());
}

// How long to wait before releasing the next queued request.
// A failure outranks the market delay, which outranks the default.
function getRequestDelay(url, status, statusText) {
    if (status === 0 || status >= 400 || statusText === 'error') {
        return REQUEST_DELAY_ERROR;
    }

    if (url.startsWith(REQUEST_MARKET_PREFIX)) {
        return REQUEST_DELAY_MARKET;
    }

    return REQUEST_DELAY_DEFAULT;
}

// transport is the one adapter this function needed to become testable: everything else
// - the delay policy (getRequestDelay), the breaker policy (REQUEST_BREAKER_*,
// stopRequests) - was already a plain value or a pure function, not something request()
// held itself. transport is not: $.ajax is a real network call, so it is a parameter
// instead, defaulting to $.ajax for every existing call site. A fake transport in tests
// takes the same jQuery-ajax-shaped settings object and answers success/error/complete
// itself, so request()'s own queueing, pending flag and breaker can be exercised with a
// fake clock and no network - see test/request.test.js.
// The single call request() makes to reach the network, injectable so tests can supply
// their own. Typed as "something that takes a jQuery-ajax-shaped settings object" rather
// than as $.ajax itself: inferring it from the default would demand jQuery's whole
// overloaded signature from every test double, which is precisely what the seam exists to
// avoid.
type RequestTransport = (settings: any) => unknown;

function request(
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

function getInventoryUrl() {
    const inventoryLoadUrl = steamPage.inventoryLoadUrl();
    if (inventoryLoadUrl) {
        return inventoryLoadUrl;
    }

    let profileUrl = `${window.location.origin}/my/`;

    const steamProfileUrl = steamPage.profileUrl();
    if (steamProfileUrl) {
        profileUrl = steamProfileUrl;
    } else {
        const avatar = document.querySelector<HTMLAnchorElement>('#global_actions a.user_avatar');

        if (avatar) {
            profileUrl = avatar.href;
        }
    }

    return `${profileUrl.replace(/\/$/, '')}/inventory/json/`;
}

//#region Settings
const SETTING_MIN_NORMAL_PRICE = 'SETTING_MIN_NORMAL_PRICE';
const SETTING_MAX_NORMAL_PRICE = 'SETTING_MAX_NORMAL_PRICE';
const SETTING_MIN_FOIL_PRICE = 'SETTING_MIN_FOIL_PRICE';
const SETTING_MAX_FOIL_PRICE = 'SETTING_MAX_FOIL_PRICE';
const SETTING_MIN_MISC_PRICE = 'SETTING_MIN_MISC_PRICE';
const SETTING_MAX_MISC_PRICE = 'SETTING_MAX_MISC_PRICE';
const SETTING_PRICE_OFFSET = 'SETTING_PRICE_OFFSET';
const SETTING_PRICE_MIN_CHECK_PRICE = 'SETTING_PRICE_MIN_CHECK_PRICE';
const SETTING_PRICE_MIN_LIST_PRICE = 'SETTING_PRICE_MIN_LIST_PRICE';
const SETTING_PRICE_ALGORITHM = 'SETTING_PRICE_ALGORITHM';
const SETTING_PRICE_IGNORE_LOWEST_Q = 'SETTING_PRICE_IGNORE_LOWEST_Q';
const SETTING_PRICE_HISTORY_HOURS = 'SETTING_PRICE_HISTORY_HOURS';
const SETTING_INVENTORY_PRICE_LABELS = 'SETTING_INVENTORY_PRICE_LABELS';
const SETTING_TRADEOFFER_PRICE_LABELS = 'SETTING_TRADEOFFER_PRICE_LABELS';
const SETTING_QUICK_SELL_BUTTONS = 'SETTING_QUICK_SELL_BUTTONS';
const SETTING_LAST_CACHE = 'SETTING_LAST_CACHE';
const SETTING_RELIST_AUTOMATICALLY = 'SETTING_RELIST_AUTOMATICALLY';

const settingDefaults = {
    SETTING_MIN_NORMAL_PRICE: 0.05,
    SETTING_MAX_NORMAL_PRICE: 2.5,
    SETTING_MIN_FOIL_PRICE: 0.15,
    SETTING_MAX_FOIL_PRICE: 10,
    SETTING_MIN_MISC_PRICE: 0.05,
    SETTING_MAX_MISC_PRICE: 10,
    SETTING_PRICE_OFFSET: 0.0,
    SETTING_PRICE_MIN_CHECK_PRICE: 0.0,
    SETTING_PRICE_MIN_LIST_PRICE: 0.03,
    SETTING_PRICE_ALGORITHM: 1,
    SETTING_PRICE_IGNORE_LOWEST_Q: 1,
    SETTING_PRICE_HISTORY_HOURS: 12,
    SETTING_INVENTORY_PRICE_LABELS: 1,
    SETTING_TRADEOFFER_PRICE_LABELS: 1,
    SETTING_QUICK_SELL_BUTTONS: 1,
    SETTING_LAST_CACHE: 0,
    SETTING_RELIST_AUTOMATICALLY: 0,
};

function getSettingWithDefault(name) {
    return getLocalStorageItem(name) || (name in settingDefaults ? settingDefaults[name] : null);
}

function setSetting(name, value) {
    setLocalStorageItem(name, value);
}
//#endregion

//#region Storage

const storagePersistent = localforage.createInstance({
    name: 'see_persistent',
});

let storageSession;

const currentUrl = new URL(window.location.href);
const noCache = currentUrl.searchParams.get('no-cache') != null;

// This does not work the same as the 'normal' session storage because opening a new browser session/tab will clear the cache.
// For this reason, a rolling cache is used.
if (getSessionStorageItem('SESSION') == null || noCache) {
    let lastCache = getSettingWithDefault(SETTING_LAST_CACHE);
    if (lastCache > 5) {
        lastCache = 0;
    }

    setSetting(SETTING_LAST_CACHE, lastCache + 1);

    storageSession = localforage.createInstance({
        name: `see_session_${lastCache}`,
    });

    storageSession.clear(); // Clear any previous data.
    setSessionStorageItem('SESSION', lastCache);
} else {
    storageSession = localforage.createInstance({
        name: `see_session_${getSessionStorageItem('SESSION')}`,
    });
}

function getLocalStorageItem(name) {
    try {
        return localStorage.getItem(name);
    } catch (e) {
        logConsole(`Failed to get local storage item ${name}, ${e}.`);
        return null;
    }
}

function setLocalStorageItem(name, value) {
    try {
        localStorage.setItem(name, value);
        return true;
    } catch (e) {
        logConsole(`Failed to set local storage item ${name}, ${e}.`);
        return false;
    }
}

function getSessionStorageItem(name) {
    try {
        return sessionStorage.getItem(name);
    } catch (e) {
        logConsole(`Failed to get session storage item ${name}, ${e}.`);
        return null;
    }
}

function setSessionStorageItem(name, value) {
    try {
        sessionStorage.setItem(name, value);
        return true;
    } catch (e) {
        logConsole(`Failed to set session storage item ${name}, ${e}.`);
        return false;
    }
}
//#endregion

//#region Price helpers
function formatPrice(valueInCents) {
    return steamPage.formatPrice(valueInCents, currencyCode, currencyCountry);
}

function getPriceInformationFromItem(item) {
    const isTradingCard = getIsTradingCard(item);
    const isFoilTradingCard = getIsFoilTradingCard(item);
    return getPriceInformation(isTradingCard, isFoilTradingCard);
}

function getPriceInformation(isTradingCard, isFoilTradingCard) {
    let maxPrice = 0;
    let minPrice = 0;

    if (!isTradingCard) {
        maxPrice = getSettingWithDefault(SETTING_MAX_MISC_PRICE);
        minPrice = getSettingWithDefault(SETTING_MIN_MISC_PRICE);
    } else {
        maxPrice = isFoilTradingCard
            ? getSettingWithDefault(SETTING_MAX_FOIL_PRICE)
            : getSettingWithDefault(SETTING_MAX_NORMAL_PRICE);
        minPrice = isFoilTradingCard
            ? getSettingWithDefault(SETTING_MIN_FOIL_PRICE)
            : getSettingWithDefault(SETTING_MIN_NORMAL_PRICE);
    }

    maxPrice = maxPrice * 100.0;
    minPrice = minPrice * 100.0;

    const maxPriceBeforeFees = market.getPriceBeforeFees(maxPrice);
    const minPriceBeforeFees = market.getPriceBeforeFees(minPrice);

    return {
        maxPrice,
        minPrice,
        maxPriceBeforeFees,
        minPriceBeforeFees,
    };
}

// Calculates the average history price, before the fee.
// The four pricing algorithms offered by the settings dialog. Lowest listing is the
// fallback the calculation lands on when none of the other three are selected, so it is
// named here for completeness rather than tested for.
const ALGORITHM_MAX_OF_HISTORY_AND_LISTING = 1;
const ALGORITHM_LOWEST_LISTING = 2;
const ALGORITHM_HIGHEST_BUY_ORDER = 3;
const ALGORITHM_AVERAGE_HISTORY = 4;

// Passed as the max to calculateSellPriceBeforeFees when there is nobody to undercut and
// no minimum/maximum should clamp the result: an unreachably high ceiling that reads back
// as "unpriced" rather than a real price. Nobody is selling this item, so there is nothing
// to show and nothing to add to a trade offer total.
const NO_LISTING_PRICE_SENTINEL = 65535;

// Everything the price calculation takes from settings, read in one place.
//
// The calculation used to reach for these itself, four settings across three functions,
// one synchronous localStorage read per item priced, plus the wall clock, the wallet's
// fee schedule and the round-vs-floor currency rule, both taken from a module-level
// `market`/`useRound` closure. Passing them in means the same inputs always give the
// same answer, which is what makes the calculation testable.
// The inputs a price calculation needs, read from settings by createPricingRules(). Every
// field is optional because the calculations each use a subset and callers -- the tests
// especially -- pass only the fields the calculation under test actually reads. That is the
// existing runtime contract, not a loosening of it.
interface PricingRules {
    algorithm?: number;
    offsetCents?: number;
    historyHours?: number;
    ignoreLowestOnLowQuantity?: boolean;
    walletInfo?: any;
    useRound?: boolean;
    now?: number;
}

function createPricingRules() {
    return {
        algorithm: Number(getSettingWithDefault(SETTING_PRICE_ALGORITHM)),
        offsetCents: Number(getSettingWithDefault(SETTING_PRICE_OFFSET)) * 100,
        historyHours: Number(getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS)),
        ignoreLowestOnLowQuantity: getSettingWithDefault(SETTING_PRICE_IGNORE_LOWEST_Q) == 1,
        walletInfo: market.walletInfo,
        useRound,
        now: Date.now(),
    };
}

// Calculate the price before fees (seller price) from the buyer price.
//
// Pure: the fee schedule and rounding rule come from `rules` rather than from the
// `market` singleton or the module-level `useRound`. SteamMarket.prototype.getPriceBeforeFees
// is a thin adapter over this for the call sites that use the market instance directly.
function priceBeforeFees(price, item, rules) {
    let publisherFee = -1;

    if (item != null) {
        if (item.market_fee != null) {
            publisherFee = item.market_fee;
        } else if (item.description != null && item.description.market_fee != null) {
            publisherFee = item.description.market_fee;
        }
    }

    if (publisherFee == -1) {
        publisherFee =
            rules.walletInfo != null
                ? rules.walletInfo['wallet_publisher_fee_percent_default']
                : 0.1;
    }

    price = Math.round(price);
    const feeInfo = CalculateFeeAmount(price, publisherFee, rules.walletInfo, rules.useRound);

    return price > feeInfo.fees ? price - feeInfo.fees : 1;
}

// Calculate the buyer price from the seller price. See priceBeforeFees.
function priceIncludingFees(price, item, rules) {
    let publisherFee = -1;

    if (item != null) {
        if (item.market_fee != null) {
            publisherFee = item.market_fee;
        } else if (item.description != null && item.description.market_fee != null) {
            publisherFee = item.description.market_fee;
        }
    }

    if (publisherFee == -1) {
        publisherFee =
            rules.walletInfo != null
                ? rules.walletInfo['wallet_publisher_fee_percent_default']
                : 0.1;
    }

    price = Math.round(price);
    const feeInfo = CalculateAmountToSendForDesiredReceivedAmount(
        price,
        publisherFee,
        rules.walletInfo,
        rules.useRound,
    );

    return feeInfo.amount;
}

function calculateAverageHistoryPriceBeforeFees(
    history,
    rules: PricingRules = createPricingRules(),
) {
    let highest = 0;
    let total = 0;

    if (history != null) {
        // Highest average price in the last xx hours.
        const timeAgo = rules.now - rules.historyHours * 60 * 60 * 1000;

        history.forEach((historyItem) => {
            const d = new Date(historyItem[0]);
            if (d.getTime() > timeAgo) {
                highest += historyItem[1] * historyItem[2];
                total += historyItem[2];
            }
        });
    }

    if (total == 0) {
        return 0;
    }

    highest = Math.floor(highest / total);
    return priceBeforeFees(highest, null, rules);
}

// Calculates the listing price, before the fee.
function calculateListingPriceBeforeFees(orderbook, rules: PricingRules = createPricingRules()) {
    if (
        typeof orderbook === 'undefined' ||
        orderbook == null ||
        orderbook.lowest_sell_order == null ||
        orderbook.sell_order_graph == null
    ) {
        return 0;
    }

    let listingPrice = priceBeforeFees(orderbook.lowest_sell_order, null, rules);

    if (rules.ignoreLowestOnLowQuantity && orderbook.sell_order_graph.length >= 2) {
        const listingPrice2ndLowest = priceBeforeFees(
            orderbook.sell_order_graph[1][0] * 100,
            null,
            rules,
        );

        if (listingPrice2ndLowest > listingPrice) {
            const numberOfListingsLowest = orderbook.sell_order_graph[0][1];
            const numberOfListings2ndLowest = orderbook.sell_order_graph[1][1];

            const percentageLower = 100 * (numberOfListingsLowest / numberOfListings2ndLowest);

            // The percentage should change based on the quantity (for example, 1200 listings vs 5, or 1 vs 25).
            if (numberOfListings2ndLowest >= 1000 && percentageLower <= 5) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 1000 && percentageLower <= 10) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 100 && percentageLower <= 15) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 50 && percentageLower <= 20) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 25 && percentageLower <= 25) {
                listingPrice = listingPrice2ndLowest;
            } else if (numberOfListings2ndLowest < 10 && percentageLower <= 30) {
                listingPrice = listingPrice2ndLowest;
            }
        }
    }

    return listingPrice;
}

function calculateBuyOrderPriceBeforeFees(orderbook, rules: PricingRules = createPricingRules()) {
    // buildOrderBook returns null for an unsuccessful response, so null reaches here as
    // readily as undefined. calculateListingPriceBeforeFees has always guarded both.
    if (typeof orderbook === 'undefined' || orderbook == null) {
        return 0;
    }

    return priceBeforeFees(orderbook.highest_buy_order, null, rules);
}

// Calculate the sell price based on the history and listings.
// applyOffset specifies whether the price offset should be applied when the listings are used to determine the price.
function calculateSellPriceBeforeFees(
    history,
    orderbook,
    applyOffset,
    minPriceBeforeFees,
    maxPriceBeforeFees,
    rules: PricingRules = createPricingRules(),
) {
    const historyPrice = calculateAverageHistoryPriceBeforeFees(history, rules);
    const listingPrice = calculateListingPriceBeforeFees(orderbook, rules);
    const buyPrice = calculateBuyOrderPriceBeforeFees(orderbook, rules);

    const shouldUseAverage = rules.algorithm === ALGORITHM_MAX_OF_HISTORY_AND_LISTING;
    const shouldUseBuyOrder = rules.algorithm === ALGORITHM_HIGHEST_BUY_ORDER;
    const shouldUseHistory = rules.algorithm === ALGORITHM_AVERAGE_HISTORY;

    // If the highest average price is lower than the first listing, return the offset + that listing.
    // Otherwise, use the highest average price instead.
    let calculatedPrice = 0;
    if (shouldUseBuyOrder) {
        calculatedPrice = buyPrice;
    } else if ((historyPrice < listingPrice || !shouldUseAverage) && !shouldUseHistory) {
        calculatedPrice = listingPrice;
    } else {
        calculatedPrice = historyPrice;
    }

    let changedToMax = false;
    // List for the maximum price if there are no listings yet.
    if (calculatedPrice == 0) {
        calculatedPrice = maxPriceBeforeFees;
        changedToMax = true;
    }

    // Apply the offset to the calculated price, but only if the price wasn't changed to the max (as otherwise it's impossible to list for this price).
    if (!changedToMax && applyOffset) {
        calculatedPrice = calculatedPrice + rules.offsetCents;
    }

    // Keep our minimum and maximum in mind.
    calculatedPrice = clamp(calculatedPrice, minPriceBeforeFees, maxPriceBeforeFees);

    // In case there's a buy order higher than the calculated price.
    if (
        !shouldUseHistory &&
        typeof orderbook !== 'undefined' &&
        orderbook != null &&
        orderbook.highest_buy_order != null
    ) {
        const buyOrderPrice = priceBeforeFees(orderbook.highest_buy_order, null, rules);
        if (buyOrderPrice > calculatedPrice) {
            calculatedPrice = buyOrderPrice;
        }
    }

    return calculatedPrice;
}
//#endregion

//#region Integer helpers
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Backoff state for one queue.
//
// The queues used to share a single module-level counter that only the inventory price
// queue ever incremented. The other three based their backoff on a number they could not
// raise, and reset it out from under the queue that could. Each queue now keeps its own.
function createFailureCounter() {
    return { failures: 0 };
}

// Records an item that came back from Steam without failing.
//
// Only a run of failures says anything about the connection, so a success ends the run.
// Without this the count only ever fell back to zero by overflowing the reset threshold,
// and two failures a hundred successful items apart still produced the long backoff.
function resetRetryDelay(counter) {
    counter.failures = 0;
}

// Records a failed item and returns how long that queue waits before the next one.
// Back off hard after more than one failure in a row, then start counting again after
// more than three so a queue does not stay in the long delay forever.
function nextRetryDelay(counter) {
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

// A unit of work on one of the script's queues. The payload differs per queue -- a listing,
// an inventory item, a listing id -- and pinning those shapes is the item-shape question
// that outlives this migration, so the payload stays open. `ignoreErrors` is the one field
// runQueue itself owns: it sets it when re-pushing a task for its single forced retry.
interface QueueTask {
    ignoreErrors?: boolean;
    [key: string]: any;
}

// Per-queue knobs. Every field is optional; the defaults are the ones nextQueueStep and
// runQueue apply when a queue passes nothing.
interface RunQueueOptions {
    /** async.queue concurrency. Defaults to 1 -- these queues talk to Steam in series. */
    concurrency?: number;
    /** Delay after a successful task, or a function producing one. Defaults to a random short delay. */
    successDelayMs?: number | (() => number);
    /** Whether a failed task gets one more attempt with ignoreErrors forced on. */
    retryOnFailure?: boolean;
}

// What a queue does after one task finishes: how long to wait before the next one, and
// whether this task gets one more try with ignoreErrors forced on before it is dropped.
//
// Pure given an explicit failure counter, so the backoff/retry decision itself is
// testable without async.queue, a worker or a real clock - the same reason
// nextRetryDelay/resetRetryDelay above take their counter as a parameter rather than
// closing over one.
function nextQueueStep(success, cached, failures, alreadyRetried, options: RunQueueOptions = {}) {
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
function runQueue(worker, options: RunQueueOptions = {}) {
    const failures = createFailureCounter();

    const queue = async.queue((task: QueueTask, next) => {
        worker(task, task.ignoreErrors === true, (success, cached) => {
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

function getNumberOfDigits(x) {
    return (Math.log10((x ^ (x >> 31)) - (x >> 31)) | 0) + 1;
}

function padLeftZero(str, max): string {
    str = str.toString();
    return str.length < max ? padLeftZero(`0${str}`, max) : str;
}

function replaceNonNumbers(str) {
    return str.replace(/\D/g, '');
}
//#endregion

//#region Listing state
// What the script worked out about a listing, kept as a value.
//
// The price and the verdict used to live in the class attribute of the listing element:
// the price was written as `price_1234` and read back by splitting the class list and
// parsing the number out of it. That made a CSS class the data model, so renaming one
// silently lost the price instead of failing. The classes are still written for styling
// and for the selector-based selection, but this is the source of truth.
//
// Keyed by listing id on the market page and by `appid_contextid_assetid` on the trade
// offer page. `set` merges, because the price is known before the verdict is.
function createListingState() {
    const states = new Map();

    return {
        get(id) {
            return states.get(String(id));
        },
        set(id, state) {
            const key = String(id);
            states.set(key, Object.assign({}, states.get(key), state));
        },
    };
}

// What the script thinks of the price a listing is asking, as a value rather than as a
// colour and a class name. `bestPrice` and `listedPrice` are both prices including fees.
function getListingVerdict(bestPrice, listedPrice) {
    if (bestPrice < listedPrice) {
        return VERDICT_OVERPRICED;
    }

    if (bestPrice > listedPrice) {
        return VERDICT_UNDERPRICED;
    }

    return VERDICT_FAIR;
}

// One store for the page. The market listings and the trade offer inventory are never
// both on screen, so they cannot collide, and the keys differ anyway.
const listingState = createListingState();

// The key an inventory item's price is kept under. It is also the id Steam gives the
// item's element, so an item is found the same way in the state and on the page.
function getAssetKey(item) {
    return `${item.appid}_${item.contextid}_${item.id}`;
}

// Whether an item has already been queued for an inventory action (sell, turn into
// gems, unpack), kept by asset key instead of on the item itself. readInventoryItems
// used to stamp `item.queued` directly onto Steam's own object, so a second pass over
// the same inventory - the user clicking "Sell All" and "Turn Into Gems" moments apart -
// saw the flag on the very same object and skipped it. readInventoryItems now returns a
// new object every call, so that no longer works; this is where the flag lives instead.
const itemQueueState = createListingState();

function isItemQueued(item) {
    return itemQueueState.get(getAssetKey(item))?.queued === true;
}

function markItemQueued(item) {
    itemQueueState.set(getAssetKey(item), { queued: true });
}
//#endregion

//#region Trade offer totals
// What one side of a trade offer holds, and what it is worth.
//
// `resolve` turns an asset into `{ name, type, originalAmount, amount, price }`, or null
// when the page cannot say what the asset is. Everything that needs the page lives in
// there, so the counting and the total are just a function of the offer.
function aggregateTradeOfferAssets(assets, resolve) {
    const counts = new Map();
    let totalPrice = 0;

    for (let i = 0; i < assets.length; i++) {
        const item = resolve(assets[i]);
        const text = getTradeOfferAssetText(item);

        counts.set(text, (counts.get(text) || 0) + 1);

        if (item != null && item.price > 0) {
            totalPrice += item.price;
        }
    }

    const items: any[] = [];
    counts.forEach((count, text) => {
        items.push({ text: text, count: count });
    });

    return { items: items, totalPrice: totalPrice };
}

// `3x Gems`, `Sackboy (Trading Card)`, or `Unknown Item` when the page cannot say what
// the asset is. A partly used stack is named by how much of it is in the offer.
function getTradeOfferAssetText(item) {
    if (item == null) {
        return 'Unknown Item';
    }

    let text = '';

    if (item.originalAmount != null && item.amount != null) {
        const usedAmount = parseInt(item.originalAmount) - parseInt(item.amount);
        text += `${usedAmount.toString()}x `;
    }

    text += item.name;

    if (item.type != null && item.type.length > 0) {
        text += ` (${item.type})`;
    }

    return text;
}
//#endregion

//#region Steam Market

// Sell an item with a price in cents.
// Price is before fees.
SteamMarket.prototype.sellItem = function (item, price, callback /*err, data*/) {
    const url = `${window.location.origin}/market/sellitem/`;

    const options = {
        method: 'POST',
        data: {
            sessionid: readCookie('sessionid'),
            appid: item.appid,
            contextid: item.contextid,
            assetid: item.assetid || item.id,
            amount: item.amount || 1,
            price: price,
        },
        responseType: 'json',
    };

    request(url, options, callback);
};

// Removes an item.
// Item is the unique item id.
SteamMarket.prototype.removeListing = function (item, isBuyOrder, callback /*err, data*/) {
    const url = isBuyOrder
        ? `${window.location.origin}/market/cancelbuyorder/`
        : `${window.location.origin}/market/removelisting/${item}`;

    const options = {
        method: 'POST',
        data: {
            sessionid: readCookie('sessionid'),
            ...(isBuyOrder ? { buy_orderid: item } : {}),
        },
        responseType: 'json',
    };

    request(url, options, (error, data) => {
        if (error) {
            callback(ERROR_FAILED);
            return;
        }

        callback(ERROR_SUCCESS, data);
    });
};

// Get the price history for an item.
//
// PriceHistory is an array of prices in the form [data, price, number sold].
// Example: [["Fri, 19 Jul 2013 01:00:00 +0000",7.30050206184,362]]
// Prices are ordered by oldest to most recent.
// Price is inclusive of fees.
SteamMarket.prototype.getPriceHistory = function (item, cache, callback) {
    const shouldUseAverage =
        getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 1 ||
        getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 4;

    if (!shouldUseAverage) {
        // The price history is only used by the "average price" calculation
        return callback(ERROR_SUCCESS, null, true);
    }

    try {
        const market_name = getMarketHashName(item);
        if (market_name == null) {
            callback(ERROR_FAILED);
            return;
        }

        const appid = item.appid;

        if (cache) {
            const storage_hash = `pricehistory_${appid}+${market_name}`;

            storageSession
                .getItem(storage_hash)
                .then((value) => {
                    if (value != null) {
                        callback(ERROR_SUCCESS, value, true);
                    } else {
                        market.getCurrentPriceHistory(appid, market_name, callback);
                    }
                })
                .catch(() => {
                    market.getCurrentPriceHistory(appid, market_name, callback);
                });
        } else {
            market.getCurrentPriceHistory(appid, market_name, callback);
        }
    } catch {
        return callback(ERROR_FAILED);
    }
};

SteamMarket.prototype.getGooValue = function (item, callback) {
    try {
        let appid = item.market_fee_app;

        for (const action of item.owner_actions) {
            if (!action.link || !action.link.startsWith('javascript:GetGooValue')) {
                continue;
            }

            const rgMatches = action.link.match(
                /GetGooValue\( *'%contextid%', *'%assetid%', *'?(?<appid>[0-9]+)'?/,
            );

            if (!rgMatches) {
                continue;
            }

            appid = rgMatches.groups.appid;
            break;
        }

        const url = `${this.inventoryUrlBase}ajaxgetgoovalue/`;

        const options = {
            method: 'GET',
            data: {
                sessionid: readCookie('sessionid'),
                appid: appid,
                assetid: item.assetid,
                contextid: item.contextid,
            },
            responseType: 'json',
        };

        request(url, options, (error, data) => {
            if (error) {
                callback(ERROR_FAILED, data);
                return;
            }

            callback(ERROR_SUCCESS, data);
        });
    } catch {
        return callback(ERROR_FAILED);
    }
    //http://steamcommunity.com/auction/ajaxgetgoovalueforitemtype/?appid=582980&item_type=18&border_color=0
    // OR
    //http://steamcommunity.com/my/ajaxgetgoovalue/?sessionid=xyz&appid=535690&assetid=4830605461&contextid=6
    //sessionid=xyz
    //appid = 535690
    //assetid = 4830605461
    //contextid = 6
};

// Grinds the item into gems.
SteamMarket.prototype.grindIntoGoo = function (item, gooValueExpected, callback) {
    try {
        const url = `${this.inventoryUrlBase}ajaxgrindintogoo/`;

        const options = {
            method: 'POST',
            data: {
                sessionid: readCookie('sessionid'),
                appid: item.market_fee_app,
                assetid: item.assetid,
                contextid: item.contextid,
                goo_value_expected: gooValueExpected,
            },
            responseType: 'json',
        };

        request(url, options, (error, data) => {
            if (error) {
                callback(ERROR_FAILED, data);
                return;
            }

            callback(ERROR_SUCCESS, data);
        });
    } catch {
        return callback(ERROR_FAILED);
    }

    //sessionid = xyz
    //appid = 535690
    //assetid = 4830605461
    //contextid = 6
    //goo_value_expected = 10
    //http://steamcommunity.com/my/ajaxgrindintogoo/
};

// Unpacks the booster pack.
SteamMarket.prototype.unpackBoosterPack = function (item, callback) {
    try {
        const url = `${this.inventoryUrlBase}ajaxunpackbooster/`;

        const options = {
            method: 'POST',
            data: {
                sessionid: readCookie('sessionid'),
                appid: item.market_fee_app,
                communityitemid: item.assetid,
            },
            responseType: 'json',
        };

        request(url, options, (error, data) => {
            if (error) {
                callback(ERROR_FAILED, data);
                return;
            }

            callback(ERROR_SUCCESS, data);
        });
    } catch {
        return callback(ERROR_FAILED);
    }

    //sessionid = xyz
    //appid = 535690
    //communityitemid = 4830605461
    //http://steamcommunity.com/my/ajaxunpackbooster/
};

// Get the current price history for an item.
SteamMarket.prototype.getCurrentPriceHistory = function (appid, market_name, callback) {
    const url = `${window.location.origin}/market/pricehistory/`;

    const options = {
        method: 'GET',
        data: {
            appid: appid,
            market_hash_name: market_name,
        },
        responseType: 'json',
    };

    request(url, options, (error, data) => {
        if (error) {
            callback(ERROR_FAILED);
            return;
        }

        if (data && (!data.success || !data.prices)) {
            callback(ERROR_DATA);
            return;
        }

        // Multiply prices so they're in pennies.
        for (let i = 0; i < data.prices.length; i++) {
            data.prices[i][1] *= 100;
            data.prices[i][2] = parseInt(data.prices[i][2]);
        }

        // Store the price history in the session storage.
        const storage_hash = `pricehistory_${appid}+${market_name}`;
        storageSession.setItem(storage_hash, data.prices);

        callback(ERROR_SUCCESS, data.prices, false);
    });
};

function buildOrderBook(data) {
    if (!data || !data.success || !data.data) {
        return null;
    }

    const orderBook = data.data;

    const buildGraph = (compactOrders) => {
        const graph: any[] = [];

        if (!Array.isArray(compactOrders)) {
            return graph;
        }

        for (let i = 0; i < compactOrders.length; i += 2) {
            const price = parseInt(compactOrders[i], 10);
            const quantity = parseInt(compactOrders[i + 1], 10);

            if (isNaN(price) || isNaN(quantity)) {
                continue;
            }

            graph.push([price / 100, quantity, '']);
        }

        return graph;
    };

    return {
        success: 1,
        highest_buy_order:
            orderBook.amtMaxBuyOrder != null ? parseInt(orderBook.amtMaxBuyOrder, 10) : 0,
        lowest_sell_order:
            orderBook.amtMinSellOrder != null ? parseInt(orderBook.amtMinSellOrder, 10) : 0,
        buy_order_graph: buildGraph(orderBook.rgCompactBuyOrders),
        sell_order_graph: buildGraph(orderBook.rgCompactSellOrders),
        cBuyOrders: orderBook.cBuyOrders,
        cSellOrders: orderBook.cSellOrders,
        eCurrency: orderBook.eCurrency,
    };
}

// Get the order book for this item in the market, with more information.
SteamMarket.prototype.getOrderBook = function (item, cache, callback) {
    try {
        const market_name = getMarketHashName(item);
        if (market_name == null) {
            callback(ERROR_FAILED);
            return;
        }

        const appid = item.appid;

        if (cache) {
            const storage_hash = `orderbook_${appid}+${market_name}`;
            storageSession
                .getItem(storage_hash)
                .then((value) => {
                    if (value != null) {
                        callback(ERROR_SUCCESS, value, true);
                    } else {
                        market.getCurrentOrderBook(item, market_name, callback);
                    }
                })
                .catch(() => {
                    market.getCurrentOrderBook(item, market_name, callback);
                });
        } else {
            market.getCurrentOrderBook(item, market_name, callback);
        }
    } catch {
        return callback(ERROR_FAILED);
    }
};

// Get the current order book for this item in the market.
SteamMarket.prototype.getCurrentOrderBook = function (item, market_name, callback) {
    const url = `${window.location.origin}/market/orderbook`;

    const options = {
        method: 'GET',
        data: {
            q: 'Load',
            qp: JSON.stringify([item.appid, market_name]),
        },
        responseType: 'json',
    };

    request(url, options, (error, data) => {
        if (error) {
            callback(ERROR_FAILED, null);
            return;
        }

        const orderbook = buildOrderBook(data?.data);
        if (orderbook == null) {
            callback(ERROR_DATA, null);
            return;
        }

        // Store the order book in the session storage.
        const storage_hash = `orderbook_${item.appid}+${market_name}`;
        storageSession.setItem(storage_hash, orderbook);

        callback(ERROR_SUCCESS, orderbook, false);
    });
};

// Calculate the price before fees (seller price) from the buyer price.
// A thin adapter over the pure priceBeforeFees: this instance's wallet and the page's
// round-vs-floor rule are the `rules` every other caller has to pass in explicitly.
SteamMarket.prototype.getPriceBeforeFees = function (price, item) {
    return priceBeforeFees(price, item, { walletInfo: this.walletInfo, useRound });
};

// Calculate the buyer price from the seller price. See getPriceBeforeFees.
SteamMarket.prototype.getPriceIncludingFees = function (price, item) {
    return priceIncludingFees(price, item, { walletInfo: this.walletInfo, useRound });
};
//#endregion

//#region Steam Market / Inventory helpers

// Flattens one Steam item: a new object with its own `description` merged onto it, so
// its fields read the same way whichever page it came from - the market page's items
// already arrive this way. `id` is stamped from the caller, because Steam's raw item is
// not always trusted to carry its own (see readInventoryItems). Steam's own object is
// left untouched; nothing here mutates `value`.
function flattenItem(value, id) {
    const item = Object.assign({}, value, value.description);
    item.id = id;
    item.assetid = id;

    return item;
}

// Flattens Steam's inventory shape into one array of new objects. The inventory page's
// active inventory (m_rgChildInventories/m_rgAssets) and the trade offer page's
// (rgChildInventories/rgInventory) were byte-for-byte identical but for these two
// property names - one reader, parameterised by them, instead of the same walk written
// out twice.
function readInventoryItems(activeInventory, childrenProperty, assetsProperty) {
    const items: any[] = [];

    if (!activeInventory) {
        return items;
    }

    const collect = (assets) => {
        for (const key in assets) {
            const value = assets[key];
            if (typeof value === 'object') {
                items.push(flattenItem(value, key));
            }
        }
    };

    for (const child in activeInventory[childrenProperty]) {
        collect(activeInventory[childrenProperty][child][assetsProperty]);
    }

    // Some inventories (e.g. BattleBlock Theater) do not have child inventories, they
    // have just one.
    collect(activeInventory[assetsProperty]);

    return items;
}

function getMarketHashName(item) {
    if (item == null) {
        return null;
    }

    if (item.description != null && item.description.market_hash_name != null) {
        return item.description.market_hash_name;
    }

    if (item.description != null && item.description.name != null) {
        return item.description.name;
    }

    if (item.market_hash_name != null) {
        return item.market_hash_name;
    }

    if (item.name != null) {
        return item.name;
    }

    return null;
}

function getIsCrate(item) {
    if (item == null) {
        return false;
    }
    // This is available on the inventory page.
    const tags =
        item.tags != null
            ? item.tags
            : item.description != null && item.description.tags != null
              ? item.description.tags
              : null;
    if (tags != null) {
        let isTaggedAsCrate = false;
        tags.forEach((arrayItem) => {
            if (arrayItem.category == 'Type') {
                if (arrayItem.internal_name == 'Supply Crate') {
                    isTaggedAsCrate = true;
                }
            }
        });
        if (isTaggedAsCrate) {
            return true;
        }
    }

    return false;
}

function getIsTradingCard(item) {
    if (item == null) {
        return false;
    }

    // This is available on the inventory page.
    const tags =
        item.tags != null
            ? item.tags
            : item.description != null && item.description.tags != null
              ? item.description.tags
              : null;
    if (tags != null) {
        let isTaggedAsTradingCard = false;
        tags.forEach((arrayItem) => {
            if (arrayItem.category == 'item_class') {
                if (arrayItem.internal_name == 'item_class_2') {
                    // trading card.
                    isTaggedAsTradingCard = true;
                }
            }
        });
        if (isTaggedAsTradingCard) {
            return true;
        }
    }

    // This is available on the market page.
    if (item.owner_actions != null) {
        for (let i = 0; i < item.owner_actions.length; i++) {
            if (item.owner_actions[i].link == null) {
                continue;
            }

            // Cards include a link to the gamecard page.
            // For example: "http://steamcommunity.com/my/gamecards/503820/".
            if (item.owner_actions[i].link.toString().toLowerCase().includes('gamecards')) {
                return true;
            }
        }
    }

    // A fallback for the market page (only works with language on English).
    if (item.type != null && item.type.toLowerCase().includes('trading card')) {
        return true;
    }

    return false;
}

function getIsFoilTradingCard(item) {
    if (!getIsTradingCard(item)) {
        return false;
    }

    // This is available on the inventory page.
    const tags =
        item.tags != null
            ? item.tags
            : item.description != null && item.description.tags != null
              ? item.description.tags
              : null;
    if (tags != null) {
        let isTaggedAsFoilTradingCard = false;
        tags.forEach((arrayItem) => {
            if (arrayItem.category == 'cardborder' && arrayItem.internal_name == 'cardborder_1') {
                // foil border.
                isTaggedAsFoilTradingCard = true;
            }
        });
        if (isTaggedAsFoilTradingCard) {
            return true;
        }
    }

    // This is available on the market page.
    if (item.owner_actions != null) {
        for (let i = 0; i < item.owner_actions.length; i++) {
            if (item.owner_actions[i].link == null) {
                continue;
            }

            // Cards include a link to the gamecard page.
            // The border parameter specifies the foil cards.
            // For example: "http://steamcommunity.com/my/gamecards/503820/?border=1".
            if (
                item.owner_actions[i].link.toString().toLowerCase().includes('gamecards') &&
                item.owner_actions[i].link.toString().toLowerCase().includes('border')
            ) {
                return true;
            }
        }
    }

    // A fallback for the market page (only works with language on English).
    if (item.type != null && item.type.toLowerCase().includes('foil trading card')) {
        return true;
    }

    return false;
}

function CalculateFeeAmount(amount, publisherFee, walletInfo, useRound?) {
    if (walletInfo == null || !walletInfo['wallet_fee']) {
        return {
            fees: 0,
        };
    }

    publisherFee = publisherFee == null ? 0 : publisherFee;
    // Since CalculateFeeAmount has a Math.floor, we could be off a cent or two. Let's check:
    let iterations = 0; // shouldn't be needed, but included to be sure nothing unforseen causes us to get stuck
    let nEstimatedAmountOfWalletFundsReceivedByOtherParty = parseInt(
        (amount - parseInt(walletInfo['wallet_fee_base'])) /
            (parseFloat(walletInfo['wallet_fee_percent']) + parseFloat(publisherFee) + 1),
    );
    let bEverUndershot = false;
    let fees = CalculateAmountToSendForDesiredReceivedAmount(
        nEstimatedAmountOfWalletFundsReceivedByOtherParty,
        publisherFee,
        walletInfo,
        useRound,
    );
    while (fees.amount != amount && iterations < 10) {
        if (fees.amount > amount) {
            if (bEverUndershot) {
                fees = CalculateAmountToSendForDesiredReceivedAmount(
                    nEstimatedAmountOfWalletFundsReceivedByOtherParty - 1,
                    publisherFee,
                    walletInfo,
                    useRound,
                );
                fees.steam_fee += amount - fees.amount;
                fees.fees += amount - fees.amount;
                fees.amount = amount;
                break;
            } else {
                nEstimatedAmountOfWalletFundsReceivedByOtherParty--;
            }
        } else {
            bEverUndershot = true;
            nEstimatedAmountOfWalletFundsReceivedByOtherParty++;
        }
        fees = CalculateAmountToSendForDesiredReceivedAmount(
            nEstimatedAmountOfWalletFundsReceivedByOtherParty,
            publisherFee,
            walletInfo,
            useRound,
        );
        iterations++;
    }
    // fees.amount should equal the passed in amount
    return fees;
}

// Clamps cur between min and max (inclusive).
function clamp(cur, min, max) {
    if (cur < min) {
        cur = min;
    }

    if (cur > max) {
        cur = max;
    }

    return cur;
}

// Strangely named function, it actually works out the fees and buyer price for a seller price
// Updated for December 2025 Steam Market rule changes:
// - 12 specific currencies now use round instead of floor for fees
// - Global minimum fee increased to $0.01 for both Steam fee and publisher fee
// Reference: https://steamcommunity.com/groups/community_market/discussions/0/682988196226679356/
function CalculateAmountToSendForDesiredReceivedAmount(
    receivedAmount,
    publisherFee,
    walletInfo,
    useRound,
) {
    if (walletInfo == null || !walletInfo['wallet_fee']) {
        return {
            amount: receivedAmount,
        };
    }

    // Select the appropriate rounding function based on currency.
    const roundFee = useRound ? Math.round : Math.floor;

    // December 2025 change: Both Steam fee and publisher fee now have a minimum of $0.01.
    // The wallet_fee_minimum from Steam represents $0.01 in the user's local currency.
    // Previously, publisher fee minimum was hardcoded to 1 (the smallest currency unit),
    // but now it should also be at least $0.01 equivalent in local currency.
    const minFee = walletInfo['wallet_fee_minimum'] || 1;

    publisherFee = publisherFee == null ? 0 : publisherFee;

    // IMPORTANT: Apply rounding/flooring BEFORE comparing with minimum fee.
    // Correct order per Steam's December 2025 rule changes:
    // 1. Calculate percentage fee (e.g., 0.05 * receivedAmount)
    // 2. Add base fee (usually 0)
    // 3. Apply round/floor based on currency
    // 4. Compare with minimum fee and take maximum
    const nSteamFee = Math.max(
        parseInt(
            roundFee(
                receivedAmount * parseFloat(walletInfo['wallet_fee_percent']) +
                    parseInt(walletInfo['wallet_fee_base']),
            ),
        ),
        minFee,
    );

    // Publisher fee: same logic, round/floor first, then compare with minFee
    const nPublisherFee =
        publisherFee > 0 ? Math.max(parseInt(roundFee(receivedAmount * publisherFee)), minFee) : 0;
    const nAmountToSend = receivedAmount + nSteamFee + nPublisherFee;
    return {
        steam_fee: nSteamFee,
        publisher_fee: nPublisherFee,
        fees: nSteamFee + nPublisherFee,
        amount: parseInt(nAmountToSend),
    };
}

function readCookie(name) {
    const nameEQ = `${name}=`;
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) == ' ') {
            c = c.substring(1, c.length);
        }
        if (c.indexOf(nameEQ) == 0) {
            return decodeURIComponent(c.substring(nameEQ.length, c.length));
        }
    }
    return null;
}

function isRetryMessage(message) {
    const messageList = [
        'You cannot sell any items until your previous action completes.',
        'There was a problem listing your item. Refresh the page and try again.',
        "We were unable to contact the game's item server. The game's item server may be down or Steam may be experiencing temporary connectivity issues. Your listing has not been created. Refresh the page and try again.",
    ];

    return messageList.indexOf(message) !== -1;
}
//#endregion

//#region Logging
let userScrolled = false;
const logger = document.createElement('div');
logger.setAttribute('id', 'logger');

// The logger is only attached to the page on the inventory page, so on every other page
// there is nothing to scroll. logDOM is reachable from those pages, most importantly from
// the request breaker, and throwing here would abandon whatever called it.
function updateScroll() {
    if (userScrolled) {
        return;
    }

    const element = document.getElementById('logger');
    if (element == null) {
        return;
    }

    element.scrollTop = element.scrollHeight;
}

function logDOM(text) {
    logger.innerHTML += `${text}<br/>`;

    updateScroll();
}

function logConsole(text) {
    if (enableConsoleLog) {
        console.log(text);
    }
}
//#endregion

//#region Inventory
// --- Page-scoped code, hoisted to module scope ------------------------------------------
//
// In code.user.js this section was wrapped in `if (currentPage == ...) { ... }`. That worked
// only because the file was one sloppy-mode IIFE: Annex B semantics hoisted function
// declarations out of the block up to function scope, so the initializeInventoryUI() /
// initializeMarketUI() / initializeTradeOfferUI() dispatch at the foot of the file could see
// them. An ES module is always strict mode, where the same declarations are block-scoped and
// invisible outside the block -- the bundler correctly removed them as unused and left the
// dispatch calling names that no longer existed. Hoisting restores the original semantics.
//
// The page gate is unchanged: it lives in that dispatch, not here. The only thing that now
// evaluates on every page is this section's inert declarations -- async.queue()/runQueue()
// objects, counters and a Set -- none of which touch the DOM, the network or Steam's page,
// and none of which anything pushes to unless the dispatch runs.
// Original guard: currentPage == PAGE_INVENTORY

function onQueueDrain() {
    if (
        itemQueue.length() == 0 &&
        sellQueue.length() == 0 &&
        scrapQueue.length() == 0 &&
        boosterQueue.length() == 0
    ) {
        removeSpinner();
    }
}

function updateTotals() {
    if ($('#loggerTotal').length == 0) {
        $(logger).parent().append('<div id="loggerTotal"></div>');
    }

    const totals = document.getElementById('loggerTotal');
    totals.innerHTML = '';

    if (totalPriceWithFeesOnMarket > 0) {
        totals.innerHTML += `<div><strong>Total listed for ${formatPrice(totalPriceWithFeesOnMarket)}, you will receive ${formatPrice(totalPriceWithoutFeesOnMarket)}.</strong></div>`;
    }
    if (totalScrap > 0) {
        totals.innerHTML += `<div><strong>Total scrap ${totalScrap}.</strong></div>`;
    }
}

const sellQueue = async.queue((task: QueueTask, next) => {
    totalNumberOfProcessedQueueItems++;

    const digits = getNumberOfDigits(totalNumberOfQueuedItems);
    const itemId = task.item.assetid || task.item.id;
    const itemName = task.item.name || task.item.description.name;
    const itemNameWithAmount =
        task.item.amount == 1 ? itemName : `${task.item.amount}x ${itemName}`;
    const padLeft = `${padLeftZero(`${totalNumberOfProcessedQueueItems}`, digits)} / ${totalNumberOfQueuedItems}`;

    if (
        getSettingWithDefault(SETTING_PRICE_MIN_LIST_PRICE) * 100 >=
        market.getPriceIncludingFees(task.sellPrice)
    ) {
        logDOM(`${padLeft} - ${itemNameWithAmount} is not listed due to ignoring price settings.`);
        markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'notChecked');
        next();
        return;
    }

    market.sellItem(task.item, task.sellPrice, (error, data) => {
        const success = Boolean(data?.success);
        const message = data?.message || '';

        const callback = () =>
            setTimeout(() => next(), getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));

        if (success) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} listed for ${formatPrice(market.getPriceIncludingFees(task.sellPrice) * task.item.amount)}, you will receive ${formatPrice(task.sellPrice * task.item.amount)}.`,
            );
            markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'success');

            totalPriceWithoutFeesOnMarket += task.sellPrice * task.item.amount;
            totalPriceWithFeesOnMarket +=
                market.getPriceIncludingFees(task.sellPrice) * task.item.amount;

            updateTotals();
            callback();

            return;
        }

        if (message && isRetryMessage(message)) {
            logDOM(
                `${padLeft} - ${itemNameWithAmount} retrying listing because: ${message.charAt(0).toLowerCase()}${message.slice(1)}`,
            );

            totalNumberOfProcessedQueueItems--;
            sellQueue.unshift(task);
            sellQueue.pause();

            setTimeout(
                () => sellQueue.resume(),
                getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
            callback();

            return;
        }

        logDOM(
            `${padLeft} - ${itemNameWithAmount} not added to market${message ? ` because:  ${message.charAt(0).toLowerCase()}${message.slice(1)}` : '.'}`,
        );
        markRow(`${task.item.appid}_${task.item.contextid}_${itemId}`, 'error');

        callback();
    });
}, 1);

sellQueue.drain(() => {
    onQueueDrain();
});

function sellAllItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            filteredItems.push(item);
        });

        sellItems(filteredItems);
    });
}

function sellAllDuplicateItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const marketableItems: any[] = [];
        let filteredItems = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            marketableItems.push(item);
        });

        filteredItems = marketableItems.filter(
            (e, i) => marketableItems.map((m) => m.classid).indexOf(e.classid) !== i,
        );

        sellItems(filteredItems);
    });
}

function gemAllDuplicateItems() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        let filteredItems = [];
        let numberOfQueuedItems = 0;

        filteredItems = items.filter(
            (e, i) => items.map((m) => m.classid).indexOf(e.classid) !== i,
        );

        filteredItems.forEach((item) => {
            if (isItemQueued(item)) {
                return;
            }

            if (item.owner_actions == null) {
                return;
            }

            let canTurnIntoGems = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('GetGooValue')
                ) {
                    canTurnIntoGems = true;
                }
            }

            if (!canTurnIntoGems) {
                return;
            }

            markItemQueued(item);
            scrapQueue.push(item);
            numberOfQueuedItems++;
        });

        if (numberOfQueuedItems > 0) {
            totalNumberOfQueuedItems += numberOfQueuedItems;

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

function sellAllCards() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            if (!getIsTradingCard(item) || !item.marketable) {
                return;
            }

            filteredItems.push(item);
        });

        sellItems(filteredItems);
    });
}

function sellAllCrates() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();
        const filteredItems: any[] = [];
        items.forEach((item) => {
            if (!getIsCrate(item) || !item.marketable) {
                return;
            }
            filteredItems.push(item);
        });

        sellItems(filteredItems);
    });
}

const scrapQueue = runQueue(scrapQueueWorker, { successDelayMs: 250 });

scrapQueue.drain(() => {
    onQueueDrain();
});

function scrapQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;
    const itemId = item.assetid || item.id;

    market.getGooValue(item, (err, goo) => {
        totalNumberOfProcessedQueueItems++;

        const digits = getNumberOfDigits(totalNumberOfQueuedItems);
        const padLeft = `${padLeftZero(`${totalNumberOfProcessedQueueItems}`, digits)} / ${totalNumberOfQueuedItems}`;

        if (err != ERROR_SUCCESS) {
            logConsole(`Failed to get gems value for ${itemName}`);
            logDOM(`${padLeft} - ${itemName} not turned into gems due to missing gems value.`);

            markRow(`${item.appid}_${item.contextid}_${itemId}`, 'error');
            return callback(false);
        }

        const gooValueExpected = parseInt(goo.goo_value, 10);

        market.grindIntoGoo(item, gooValueExpected, (err) => {
            if (err != ERROR_SUCCESS) {
                logConsole(`Failed to turn item into gems for ${itemName}`);
                logDOM(`${padLeft} - ${itemName} not turned into gems due to unknown error.`);

                markRow(`${item.appid}_${item.contextid}_${itemId}`, 'error');
                return callback(false);
            }

            logConsole('============================');
            logConsole(itemName);
            logConsole(`Turned into ${goo.goo_value} gems`);
            logDOM(`${padLeft} - ${itemName} turned into ${gooValueExpected} gems.`);
            markRow(`${item.appid}_${item.contextid}_${itemId}`, 'success');

            totalScrap += gooValueExpected;
            updateTotals();

            callback(true);
        });
    });
}

const boosterQueue = runQueue(boosterQueueWorker, { successDelayMs: 250 });

boosterQueue.drain(() => {
    onQueueDrain();
});

function boosterQueueWorker(item, ignoreErrors, callback) {
    const itemName = item.name || item.description.name;
    const itemId = item.assetid || item.id;

    market.unpackBoosterPack(item, (err) => {
        totalNumberOfProcessedQueueItems++;

        const digits = getNumberOfDigits(totalNumberOfQueuedItems);
        const padLeft = `${padLeftZero(`${totalNumberOfProcessedQueueItems}`, digits)} / ${totalNumberOfQueuedItems}`;

        if (err != ERROR_SUCCESS) {
            logConsole(`Failed to unpack booster pack ${itemName}`);
            logDOM(`${padLeft} - ${itemName} not unpacked.`);

            markRow(`${item.appid}_${item.contextid}_${itemId}`, 'error');
            return callback(false);
        }

        logDOM(`${padLeft} - ${itemName} unpacked.`);
        markRow(`${item.appid}_${item.contextid}_${itemId}`, 'success');

        callback(true);
    });
}

// Turns the selected items into gems.
function turnSelectedItemsIntoGems() {
    const ids = getSelectedItems();

    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();

        let numberOfQueuedItems = 0;
        items.forEach((item) => {
            // Ignored queued items.
            if (isItemQueued(item)) {
                return;
            }

            if (item.owner_actions == null) {
                return;
            }

            let canTurnIntoGems = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('GetGooValue')
                ) {
                    canTurnIntoGems = true;
                }
            }

            if (!canTurnIntoGems) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                markItemQueued(item);
                scrapQueue.push(item);
                numberOfQueuedItems++;
            }
        });

        if (numberOfQueuedItems > 0) {
            totalNumberOfQueuedItems += numberOfQueuedItems;

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

// Unpacks all booster packs.
function unpackAllBoosterPacks() {
    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();

        let numberOfQueuedItems = 0;

        items.forEach((item) => {
            if (isItemQueued(item) || item.owner_actions == null) {
                return;
            }

            let canOpenBooster = false;

            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('OpenBooster')
                ) {
                    canOpenBooster = true;
                }
            }

            if (!canOpenBooster) {
                return;
            }

            markItemQueued(item);
            boosterQueue.push(item);
            numberOfQueuedItems++;
        });

        if (numberOfQueuedItems === 0) {
            logDOM('No booster packs found in the inventory to unpack.');

            return;
        }

        totalNumberOfQueuedItems += numberOfQueuedItems;

        renderSpinner(`Processing ${numberOfQueuedItems} items`);
    });
}

// Unpacks the selected booster packs.
function unpackSelectedBoosterPacks() {
    const ids = getSelectedItems();

    renderSpinner('Loading inventory items');

    loadAllInventories().then(() => {
        removeSpinner();

        const items = getInventoryItems();

        let numberOfQueuedItems = 0;
        items.forEach((item) => {
            // Ignored queued items.
            if (isItemQueued(item) || item.owner_actions == null) {
                return;
            }

            let canOpenBooster = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('OpenBooster')
                ) {
                    canOpenBooster = true;
                }
            }

            if (!canOpenBooster) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                markItemQueued(item);
                boosterQueue.push(item);
                numberOfQueuedItems++;
            }
        });

        if (numberOfQueuedItems > 0) {
            totalNumberOfQueuedItems += numberOfQueuedItems;

            renderSpinner(`Processing ${numberOfQueuedItems} items`);
        }
    });
}

function sellSelectedItems() {
    getInventorySelectedMarketableItems((items) => {
        sellItems(items);
    });
}

function canSellSelectedItemsManually(items) {
    // We have to construct an URL like this
    // https://steamcommunity.com/market/multisell?appid=730&contextid=2&items[]=Falchion%20Case&qty[]=100
    const contextid = items[0].contextid;
    let hasInvalidItem = false;

    items.forEach((item) => {
        if (item.contextid != contextid || item.commodity == false) {
            hasInvalidItem = true;
        }
    });

    return !hasInvalidItem;
}

function sellSelectedItemsManually() {
    getInventorySelectedMarketableItems((items) => {
        // We have to construct an URL like this
        // https://steamcommunity.com/market/multisell?appid=730&contextid=2&items[]=Falchion%20Case&qty[]=100

        const appid = items[0].appid;
        const contextid = items[0].contextid;

        const itemsWithQty = {};

        items.forEach((item) => {
            itemsWithQty[item.market_hash_name] = itemsWithQty[item.market_hash_name] + 1 || 1;
        });

        let itemsString = '';
        for (const itemName in itemsWithQty) {
            itemsString += `&items[]=${encodeURIComponent(itemName)}&qty[]=${itemsWithQty[itemName]}`;
        }

        const baseUrl = `${window.location.origin}/market/multisell`;
        const redirectUrl = `${baseUrl}?appid=${appid}&contextid=${contextid}${itemsString}`;

        const dialog = steamPage.showDialog(
            'Steam Economy Enhancer',
            `<iframe frameBorder="0" height="650" width="900" src="${redirectUrl}"></iframe>`,
        );
        dialog.OnDismiss(() => {
            items.forEach((item) => {
                const itemId = item.assetid || item.id;
                markRow(`${item.appid}_${item.contextid}_${itemId}`, 'pending');
            });
        });
    });
}

function sellItems(items) {
    if (items.length == 0) {
        logDOM('These items cannot be added to the market...');

        return;
    }

    let numberOfQueuedItems = 0;

    items.forEach((item) => {
        // Ignored queued items.
        if (isItemQueued(item)) {
            return;
        }

        markItemQueued(item);
        // item.ignoreErrors starts undefined, which reads the same as false to
        // runQueue's retryOnFailure check - no need to initialise it explicitly on a
        // freshly-read item the way there was when items were mutated in place.
        itemQueue.push(item);
        numberOfQueuedItems++;
    });

    if (numberOfQueuedItems > 0) {
        totalNumberOfQueuedItems += numberOfQueuedItems;

        renderSpinner(`Processing ${numberOfQueuedItems} items`);
    }
}

// A cached answer never reached Steam, and its delay is discarded, so it says
// nothing about the connection either way - see nextQueueStep. A failed item gets
// one more try with ignoreErrors forced true before it is dropped.
const itemQueue = runQueue(itemQueueWorker, { retryOnFailure: true });

// itemQueue feeds sellQueue but never triggered onQueueDrain itself; only sellQueue
// finishing did, relying on it always draining after the last item itemQueue produced.
// True in practice, but only by luck of the two queues' relative timing. Registered
// directly now, like the other three queues onQueueDrain checks.
itemQueue.drain(() => {
    onQueueDrain();
});

function itemQueueWorker(item, ignoreErrors, callback) {
    const priceInfo = getPriceInformationFromItem(item);

    let failed = 0;
    const itemName = item.name || item.description.name;

    market.getPriceHistory(item, true, (err, history, cachedHistory) => {
        if (err) {
            logConsole(`Failed to get price history for ${itemName}`);

            if (err != ERROR_SUCCESS) {
                failed += 1;
            }
        }

        market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
            if (err) {
                logConsole(`Failed to get order book for ${itemName}`);

                if (err != ERROR_SUCCESS) {
                    failed += 1;
                }
            }

            if (failed > 0 && !ignoreErrors) {
                return callback(false, cachedHistory && cachedListings);
            }

            logConsole('============================');
            logConsole(itemName);

            const sellPrice = calculateSellPriceBeforeFees(
                history,
                orderbook,
                true,
                priceInfo.minPriceBeforeFees,
                priceInfo.maxPriceBeforeFees,
                createPricingRules(),
            );

            logConsole(
                `Sell price: ${sellPrice / 100.0} (${market.getPriceIncludingFees(sellPrice) / 100.0})`,
            );

            sellQueue.push({
                item: item,
                sellPrice: sellPrice,
            });

            return callback(true, cachedHistory && cachedListings);
        });
    });
}

// Initialize the inventory UI.
function initializeInventoryUI() {
    const isOwnInventory = steamPage.activeUser().strSteamId == steamPage.steamId();
    let previousSelection = -1; // To store the index of the previous selection.
    updateInventoryUI(isOwnInventory);

    $('.games_list_tabs').on('click', '*', () => {
        updateInventoryUI(isOwnInventory);
    });

    // Ignore selection on other user's inventories.
    if (!isOwnInventory) {
        return;
    }

    // Steam adds 'display:none' to items while searching. These should not be selected while using shift/ctrl.
    const filter = '.itemHolder:not([style*=none])';
    $('#inventories').selectable({
        filter: filter,
        selecting: function (e, ui) {
            // Get selected item index.
            const selectedIndex = $(ui.selecting.tagName, e.target).index(ui.selecting);

            // If shift key was pressed and there is previous - select them all.
            if (e.shiftKey && previousSelection > -1) {
                $(ui.selecting.tagName, e.target)
                    .slice(
                        Math.min(previousSelection, selectedIndex),
                        1 + Math.max(previousSelection, selectedIndex),
                    )
                    .each(function () {
                        if ($(this).is(filter)) {
                            $(this).addClass('ui-selected');
                        }
                    });
                previousSelection = -1; // Reset previous.
            } else {
                previousSelection = selectedIndex; // Save previous.
            }
        },
        selected: function () {
            updateButtons();
        },
    });

    // Not torn down: initializeInventoryUI runs exactly once, on page load. The
    // teardown exists for whoever calls this a second time - a test, or a future
    // SPA-style re-init - to undo it rather than stack another wrapper on top.
    steamPage.onInventorySelectItem((rgItem) => {
        updateButtons();

        // rgItem comes straight from Steam, not from readInventoryItems, so it is
        // flattened here rather than assumed to already be - readInventoryItems no
        // longer mutates Steam's own objects, so this used to be the one path that
        // quietly depended on some earlier, unrelated call having done so already.
        updateInventorySelection(flattenItem(rgItem, rgItem.assetid || rgItem.id));
    });
}

// Gets the selected items in the inventory.
function getSelectedItems() {
    const ids: string[] = [];
    $('.inventory_ctn').each(function () {
        $(this)
            .find('.inventory_page')
            .each(function () {
                const inventory_page = this;

                $(inventory_page)
                    .find('.itemHolder.ui-selected:not([style*=none])')
                    .each(function () {
                        $(this)
                            .find('.item')
                            .each(function () {
                                const matches = this.id.match(/_(-?\d+)$/);
                                if (matches) {
                                    ids.push(matches[1]);
                                }
                            });
                    });
            });
    });

    return ids;
}

// Gets the selected and marketable items in the inventory.
function getInventorySelectedMarketableItems(callback) {
    const ids = getSelectedItems();

    loadAllInventories().then(() => {
        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            if (!item.marketable) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                filteredItems.push(item);
            }
        });

        callback(filteredItems);
    });
}

// Gets the selected and gemmable items in the inventory.
function getInventorySelectedGemsItems(callback) {
    const ids = getSelectedItems();

    loadAllInventories().then(() => {
        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            let canTurnIntoGems = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('GetGooValue')
                ) {
                    canTurnIntoGems = true;
                }
            }

            if (!canTurnIntoGems) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                filteredItems.push(item);
            }
        });

        callback(filteredItems);
    });
}

// Gets the selected and booster pack items in the inventory.
function getInventorySelectedBoosterPackItems(callback) {
    const ids = getSelectedItems();

    loadAllInventories().then(() => {
        const items = getInventoryItems();
        const filteredItems: any[] = [];

        items.forEach((item) => {
            let canOpenBooster = false;
            for (const owner_action in item.owner_actions) {
                if (
                    item.owner_actions[owner_action].link != null &&
                    item.owner_actions[owner_action].link.includes('OpenBooster')
                ) {
                    canOpenBooster = true;
                }
            }

            if (!canOpenBooster) {
                return;
            }

            const itemId = item.assetid || item.id;
            if (ids.indexOf(itemId) !== -1) {
                filteredItems.push(item);
            }
        });

        callback(filteredItems);
    });
}

// Updates the (selected) sell ... items button.
function updateSellSelectedButton() {
    getInventorySelectedMarketableItems((items) => {
        const selectedItems = items.length;
        if (items.length == 0) {
            $('.sell_selected').hide();
            $('.sell_manual').hide();
        } else {
            $('.sell_selected').show();
            if (canSellSelectedItemsManually(items)) {
                $('.sell_manual').show();
                $('.sell_manual > span').text(
                    `Sell ${selectedItems}${selectedItems == 1 ? ' Item Manual' : ' Items Manual'}`,
                );
            } else {
                $('.sell_manual').hide();
            }
            $('.sell_selected > span').text(
                `Sell ${selectedItems}${selectedItems == 1 ? ' Item' : ' Items'}`,
            );
        }
    });
}

// Updates the (selected) turn into ... gems button.
function updateTurnIntoGemsButton() {
    getInventorySelectedGemsItems((items) => {
        const selectedItems = items.length;
        if (items.length == 0) {
            $('.turn_into_gems').hide();
        } else {
            $('.turn_into_gems').show();
            $('.turn_into_gems > span').text(
                `Turn ${selectedItems}${selectedItems == 1 ? ' Item Into Gems' : ' Items Into Gems'}`,
            );
        }
    });
}

// Updates the (selected) open ... booster packs button.
function updateOpenBoosterPacksButton() {
    getInventorySelectedBoosterPackItems((items) => {
        const selectedItems = items.length;
        if (items.length == 0) {
            $('.unpack_selected_booster_packs').hide();
        } else {
            $('.unpack_selected_booster_packs').show();
            $('.unpack_selected_booster_packs > span').text(
                `Unpack ${selectedItems}${selectedItems == 1 ? ' Booster Pack' : ' Booster Packs'}`,
            );
        }
    });
}

function updateButtons() {
    updateSellSelectedButton();
    updateTurnIntoGemsButton();
    updateOpenBoosterPacksButton();
}

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function updateInventorySelection(selectedItem) {
    if (getSettingWithDefault(SETTING_QUICK_SELL_BUTTONS) != 1) {
        return;
    }

    const item_info = $(`#iteminfo${steamPage.activeSelectView()}`);

    if (!item_info.length) {
        return;
    }

    if (item_info.html().indexOf('checkout/sendgift/') > -1) {
        // Gifts have no market information.
        return;
    }

    let timeDelayed = 0;

    // Wait until item_info is loaded.
    while (
        timeDelayed < 2500 &&
        item_info.find('a[href^="https://steamcommunity.com/market/listings/"]').length == 0
    ) {
        await delay(100);
        timeDelayed += 100;
    }

    const market_hash_name = getMarketHashName(selectedItem);
    if (market_hash_name == null) {
        return;
    }

    const appid = selectedItem.appid;
    const item = {
        appid: parseInt(appid),
        description: {
            market_hash_name: market_hash_name,
        },
    };

    const isBoosterPack = selectedItem.name.toLowerCase().endsWith('booster pack');
    if (isBoosterPack) {
        const tradingCardsUrl = `/market/search?q=&category_753_Game%5B%5D=tag_app_${selectedItem.market_fee_app}&category_753_item_class%5B%5D=tag_item_class_2&appid=753`;
        const communityHeader = $('h1', item_info).next().find('span').eq(0);
        communityHeader.replaceWith(
            `<a href="${tradingCardsUrl}"><span>${communityHeader.text()}</span></a>`,
        );
    }

    // Skip unmarketable items
    if (!selectedItem.marketable) {
        return;
    }

    // Ignored queued items.
    if (isItemQueued(selectedItem)) {
        return;
    }

    const marketLink = `https://steamcommunity.com/market/listings/${appid}/${encodeURIComponent(market_hash_name)}`;
    const baseLink = $(`a[href^="${marketLink}"]`, item_info);
    const ownerActions = baseLink.parent().parent();

    market.getOrderBook(item, false, (err, orderbook) => {
        if (err) {
            logConsole(
                `Failed to get order book for ${selectedItem.name || selectedItem.description.name}`,
            );
            return;
        }

        // Ignored queued items.
        if (isItemQueued(selectedItem)) {
            return;
        }

        const sellRows = (orderbook.sell_order_graph || [])
            .slice(0, 10)
            .map(
                ([price, qty]) =>
                    `<tr><td align="right">${formatPrice(Math.round(price * 100))}</td><td align="right">${qty}</td></tr>`,
            )
            .join('');

        const buyRows = (orderbook.buy_order_graph || [])
            .slice(0, 10)
            .map(
                ([price, qty]) =>
                    `<tr><td align="right">${formatPrice(Math.round(price * 100))}</td><td align="right">${qty}</td></tr>`,
            )
            .join('');

        const groupMain = $(`<div id="listings_group">
                <div>
                    <div id="listings_sell">Sell</div>
                    <table class="market_commodity_orders_table"><tr><th align="right">Price</th><th align="right">Quantity</th></tr>${sellRows}</table>
                </div>
                <div>
                    <div id="listings_buy">Buy</div>
                    <table class="market_commodity_orders_table"><tr><th align="right">Price</th><th align="right">Quantity</th></tr>${buyRows}</table>
                </div>
            </div>`);

        baseLink.next().append(groupMain);

        // Generate quick sell buttons.
        let prices: number[] = [];

        if (orderbook != null && orderbook.highest_buy_order != null) {
            prices.push(parseInt(orderbook.highest_buy_order));
        }

        if (orderbook != null && orderbook.lowest_sell_order != null) {
            // Transaction volume must be separable into three or more parts (no matter if equal): valve+publisher+seller.
            if (parseInt(orderbook.lowest_sell_order) > 3) {
                prices.push(parseInt(orderbook.lowest_sell_order) - 1);
            }
            prices.push(parseInt(orderbook.lowest_sell_order));
        }

        prices = prices.filter((v, i) => prices.indexOf(v) === i).sort((a, b) => a - b);

        let buttons = '<div id="price_buttons">';
        prices.forEach((e) => {
            buttons += `<a class="item_market_action_button item_market_action_button_green quick_sell" id="quick_sell${e}">
                    <span class="item_market_action_button_edge item_market_action_button_left"></span>
                    <span class="item_market_action_button_contents">${formatPrice(e)}</span>
                    <span class="item_market_action_button_edge item_market_action_button_right"></span>
                    <span class="item_market_action_button_preload"></span>
                </a>`;
        });
        buttons += '</div>';

        ownerActions.append(buttons);

        ownerActions.append(`<div id="sell_button" style="display:flex">
                <input id="quick_sell_input" style="background-color: black;color: white;border: transparent;max-width:65px;text-align:center;" type="number" value="${((orderbook.lowest_sell_order || 0) / 100).toFixed(2)}" step="0.01" />&nbsp;
                <a class="item_market_action_button item_market_action_button_green quick_sell_custom">
                    <span class="item_market_action_button_edge item_market_action_button_left"></span>
                    <span class="item_market_action_button_contents">➜ Sell</span>
                    <span class="item_market_action_button_edge item_market_action_button_right"></span>
                    <span class="item_market_action_button_preload"></span>
                </a>
            </div>`);

        $('.quick_sell').on('click', function () {
            let price = $(this).attr('id').replace('quick_sell', '');
            price = market.getPriceBeforeFees(price);

            totalNumberOfQueuedItems++;

            sellQueue.push({
                item: selectedItem,
                sellPrice: price,
            });
        });

        $('.quick_sell_custom').on('click', () => {
            let price = $('#quick_sell_input', ownerActions).val() * 100;
            price = market.getPriceBeforeFees(price);

            totalNumberOfQueuedItems++;

            sellQueue.push({
                item: selectedItem,
                sellPrice: price,
            });
        });
    });
}

// Update the inventory UI.
function updateInventoryUI(isOwnInventory) {
    // Remove previous containers (e.g., when a user changes inventory).
    $('#inventory_sell_buttons').remove();
    $('#see_settings_modal').remove();
    $('#inventory_reload_button').remove();

    $('#see_settings').remove();
    $('#global_action_menu').prepend(
        '<span id="see_settings"><a href="javascript:void(0)">⬖ Steam Economy Enhancer</a></span>',
    );
    $('#see_settings').on('click', '*', () => openSettings());

    const appId = getActiveInventory().m_appid;
    const showMiscOptions = appId == 753;
    const TF2 = appId == 440;

    let buttonsHtml = `
        <a class="btn_green_white_innerfade btn_medium_wide sell_all"><span>Sell All Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_all_duplicates"><span>Sell All Duplicate Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_selected" style="display:none"><span>Sell Selected Items</span></a>
        <a class="btn_green_white_innerfade btn_medium_wide sell_manual" style="display:none"><span>Sell Manually</span></a>
    `;

    if (showMiscOptions) {
        buttonsHtml += `
            <a class="btn_green_white_innerfade btn_medium_wide sell_all_cards"><span>Sell All Cards</span></a>
            <div class="see_inventory_buttons">
                <a class="btn_darkblue_white_innerfade btn_medium_wide turn_into_gems" style="display:none"><span>Turn Selected Items Into Gems</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide unpack_all_booster_packs"><span>Unpack All Booster Packs</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide unpack_selected_booster_packs" style="display:none"><span>Unpack Selected Booster Packs</span></a>
                <a class="btn_darkblue_white_innerfade btn_medium_wide gem_all_duplicates"><span>Turn All Duplicate Items Into Gems</span></a>
            </div>
        `;
    } else if (TF2) {
        buttonsHtml +=
            '<a class="btn_green_white_innerfade btn_medium_wide sell_all_crates"><span>Sell All Crates</span></a>';
    }

    const sellButtons = $(
        `<div id="inventory_sell_buttons" class="see_inventory_buttons">${buttonsHtml}</div>`,
    );

    const reloadButton = $(
        '<a id="inventory_reload_button" class="btn_darkblue_white_innerfade btn_medium_wide reload_inventory" style="margin-right:12px"><span>Reload Inventory</span></a>',
    );

    const logo = $('#inventory_logos')[0];
    logo.style.height = 'auto';
    logo.style.maxHeight = 'unset';

    $('#inventory_applogo').hide(); // Hide the Steam/game logo, we don't need to see it twice.
    $('#inventory_applogo').after(logger);

    $('#logger').on('scroll', () => {
        const hasUserScrolledToBottom =
            $('#logger').prop('scrollHeight') - $('#logger').prop('clientHeight') <=
            $('#logger').prop('scrollTop') + 1;
        userScrolled = !hasUserScrolledToBottom;
    });

    // Only add buttons on the user's inventory.
    if (isOwnInventory) {
        $('#inventory_applogo').after(sellButtons);

        // Add bindings to sell buttons.
        $('.sell_all').on('click', '*', () => {
            sellAllItems();
        });
        $('.sell_selected').on('click', '*', sellSelectedItems);
        $('.sell_all_duplicates').on('click', '*', sellAllDuplicateItems);
        $('.gem_all_duplicates').on('click', '*', gemAllDuplicateItems);
        $('.sell_manual').on('click', '*', sellSelectedItemsManually);
        $('.sell_all_cards').on('click', '*', sellAllCards);
        $('.sell_all_crates').on('click', '*', sellAllCrates);
        $('.turn_into_gems').on('click', '*', turnSelectedItemsIntoGems);
        $('.unpack_all_booster_packs').on('click', '*', unpackAllBoosterPacks);
        $('.unpack_selected_booster_packs').on('click', '*', unpackSelectedBoosterPacks);
    }

    $('.inventory_rightnav').prepend(reloadButton);
    $('.reload_inventory').on('click', '*', () => {
        window.location.reload();
    });

    loadAllInventories().then(() => {
        const updateInventoryPrices = function () {
            if (getSettingWithDefault(SETTING_INVENTORY_PRICE_LABELS) == 1) {
                setInventoryPrices(getInventoryItems());
            }
        };

        // Load after the inventory is loaded.
        updateInventoryPrices();

        $('#pagecontrol_cur').observe('childlist', () => {
            updateInventoryPrices();
        });
    });
}

// Loads all inventories.
async function loadAllInventories() {
    const main = getActiveInventory();

    const childs = Object.values(main.m_rgChildInventories);

    for (const inventory of [...childs, main]) {
        await new Promise((resolve) => inventory.LoadCompleteInventory().done(resolve));
    }
}

// Gets the inventory items from the active inventory.
function getInventoryItems() {
    return readInventoryItems(getActiveInventory(), 'm_rgChildInventories', 'm_rgAssets');
}
//#endregion

//#region Inventory + Tradeoffer
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_INVENTORY || currentPage == PAGE_TRADEOFFER

// Gets the active inventory.
function getActiveInventory() {
    return steamPage.activeInventory();
}

// Sets the prices for the items.
function setInventoryPrices(items) {
    inventoryPriceQueue.kill();

    items.forEach((item) => {
        if (!item.marketable) {
            return;
        }

        if (!$(item.element).is(':visible')) {
            return;
        }

        inventoryPriceQueue.push(item);
    });
}

// Bug fixed here: this queue's worker used to always be called with ignoreErrors
// hardcoded to false, even on the forced retry, so a persistently failing item's
// price label silently never appeared - unlike itemQueue, whose retry actually forces
// past the failure. runQueue passes the item's real ignoreErrors flag, matching
// itemQueue's behaviour.
const inventoryPriceQueue = runQueue(inventoryPriceQueueWorker, { retryOnFailure: true });

function inventoryPriceQueueWorker(item, ignoreErrors, callback) {
    let failed = 0;
    const itemName = item.name || item.description.name;

    // Only get the market orders here, the history is not important to visualize the current prices.
    market.getOrderBook(item, true, (err, orderbook, cachedListings) => {
        if (err) {
            logConsole(`Failed to get order book for ${itemName}`);

            if (err != ERROR_SUCCESS) {
                failed += 1;
            }
        }

        if (failed > 0 && !ignoreErrors) {
            return callback(false, cachedListings);
        }

        const sellPrice = calculateSellPriceBeforeFees(
            null,
            orderbook,
            false,
            0,
            NO_LISTING_PRICE_SENTINEL,
            createPricingRules(),
        );

        // Nobody is selling this one, so there is no price to show and nothing to
        // add to a trade offer total.
        const priceWithFees =
            sellPrice == NO_LISTING_PRICE_SENTINEL ? 0 : market.getPriceIncludingFees(sellPrice);
        const itemPrice = sellPrice == NO_LISTING_PRICE_SENTINEL ? '∞' : formatPrice(priceWithFees);

        listingState.set(getAssetKey(item), { sellPrice: priceWithFees });

        const elementName = `${currentPage == PAGE_TRADEOFFER ? '#item' : '#'}${getAssetKey(item)}`;
        const element = $(elementName);

        $('.inventory_item_price', element).remove();
        element.append(`<span class="inventory_item_price">${itemPrice}</span>`);

        return callback(true, cachedListings);
    });
}
//#endregion

//#region Market
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_MARKET || currentPage == PAGE_MARKET_LISTING
const marketListingsRelistedAssets: any[] = [];
let marketProgressBar: any;

// Progress of the current relist run, shown on the relist overpriced button.
// Both are reset once nothing is queueing relists any more, see resetMarketRelistProgress.
let marketRelistTotal = 0;
let marketRelistDone = 0;

// Listings already queued for relisting. Relisting one twice is pointless work: the
// second attempt looks up a listing that the first one already removed. This replaces
// disabling the buttons for the duration of the run, which also blocked relisting a
// hand-picked selection while automatic relisting was working through another one.
const marketRelistQueuedListings = new Set();

function increaseMarketProgressMax() {
    let value = marketProgressBar.max;

    // Reset the progress bar if it already completed
    if (marketProgressBar.value === value) {
        marketProgressBar.value = 0;
        value = 0;
    }

    marketProgressBar.max = value + 1;
    marketProgressBar.removeAttribute('hidden');
}

// Refreshing the buttons walks every listing of every list, so calling it once per
// listing makes a pass over N listings cost N squared. Listings answered from the cache
// are processed with no delay between them, which turns a full page of them into one
// burst, so coalesce whatever arrives before the next frame into a single refresh.
let marketOverpricedButtonsQueued = false;

function refreshMarketOverpricedButtons() {
    if (marketOverpricedButtonsQueued) {
        return;
    }

    marketOverpricedButtonsQueued = true;

    const refresh = () => {
        marketOverpricedButtonsQueued = false;
        updateMarketOverpricedButtons();
    };

    if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(refresh);
    } else {
        setTimeout(refresh, 0);
    }
}

function increaseMarketProgress() {
    marketProgressBar.value += 1;

    if (marketProgressBar.value === marketProgressBar.max) {
        marketProgressBar.setAttribute('hidden', 'true');
    }

    // A listing was just priced, relisted or removed, so the overpriced count may have changed.
    refreshMarketOverpricedButtons();
}

// Match number part from any currency format
const getPriceValueAsInt = (listing) =>
    steamPage.parsePriceText(listing.match(/(?<price>[0-9][0-9 .,]*)/)?.groups?.price ?? 0);

const marketListingsQueue = async.queue((listing: QueueTask, next) => {
    marketListingsQueueWorker(listing, false, (success, cached) => {
        const callback = () => {
            increaseMarketProgress();
            next();
        };

        if (success) {
            setTimeout(
                callback,
                cached ? 0 : getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX),
            );
        } else {
            setTimeout(
                () => marketListingsQueueWorker(listing, true, callback),
                cached ? 0 : getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
        }
    });
}, 1);

function marketListingsQueueWorker(listing, ignoreErrors, callback) {
    const asset = steamPage.assetFor(listing.appid, listing.contextid, listing.assetid);

    // An asset:
    //{
    // "currency" : 0,
    // "appid" : 753,
    // "contextid" : "6",
    // "id" : "4363079664",
    // "classid" : "2228526061",
    // "instanceid" : "0",
    // "amount" : "1",
    // "status" : 2,
    // "original_amount" : "1",
    // "background_color" : "",
    // "icon_url" : "xx",
    // "icon_url_large" : "xxx",
    // "descriptions" : [{
    //   "value" : "Their dense, shaggy fur conceals the presence of swams of moogamites, purple scaly skin, and more nipples than one would expect."
    //  }
    // ],
    // "tradable" : 1,
    // "owner_actions" : [{
    //   "link" : "http://steamcommunity.com/my/gamecards/443880/",
    //   "name" : "View badge progress"
    //  }, {
    //   "link" : "javascript:GetGooValue( '%contextid%', '%assetid%', 443880, 7, 0 )",
    //   "name" : "Turn into Gems..."
    //  }
    // ],
    // "name" : "Wook",
    // "type" : "Loot Rascals Trading Card",
    // "market_name" : "Wook",
    // "market_hash_name" : "443880-Wook",
    // "market_fee_app" : 443880,
    // "commodity" : 1,
    // "market_tradable_restriction" : 7,
    // "market_marketable_restriction" : 7,
    // "marketable" : 1,
    // "app_icon" : "xxxx",
    // "owner" : 0
    //}

    const market_hash_name = getMarketHashName(asset);
    const appid = listing.appid;

    let listingUI = getListingFromLists(listing.listingid);
    if (listingUI == null) {
        logConsole(`Listing ${listing.listingid} not found in the lists, skipping.`);

        callback(true, true);

        return;
    }

    listingUI = $(listingUI.elm);

    const game_name = asset.type;
    const price = getPriceValueAsInt(
        $('.market_listing_price > span:nth-child(1) > span:nth-child(1)', listingUI).text(),
    );

    if (
        price <= getSettingWithDefault(SETTING_PRICE_MIN_CHECK_PRICE) * 100 ||
        listingUI.hasClass('removing')
    ) {
        $('.market_listing_my_price', listingUI).last().css('background', COLOR_PRICE_NOT_CHECKED);
        $('.market_listing_my_price', listingUI).last().prop('title', 'The price is not checked.');
        listingUI.addClass('not_checked');

        return callback(true, true);
    }

    const priceInfo = getPriceInformationFromItem(asset);
    const item = {
        appid: parseInt(appid),
        description: {
            market_hash_name: market_hash_name,
        },
    };

    let failed = 0;

    market.getPriceHistory(item, true, (errorPriceHistory, history, cachedHistory) => {
        if (errorPriceHistory) {
            logConsole(`Failed to get price history for ${game_name}`);

            if (errorPriceHistory != ERROR_SUCCESS) {
                failed += 1;
            }
        }

        market.getOrderBook(item, true, (errorOrderBook, orderbook, cachedListings) => {
            if (errorOrderBook) {
                logConsole(`Failed to get order book for ${game_name}`);

                if (errorOrderBook != ERROR_SUCCESS) {
                    failed += 1;
                }
            }

            if (failed > 0 && !ignoreErrors) {
                return callback(false, cachedHistory && cachedListings);
            }

            // Shows the highest buy order price on the market listings.
            // The 'orderbook.highest_buy_order' is not reliable as Steam is caching this value, but it gives some idea for older titles/listings.
            const highestBuyOrderPrice =
                orderbook == null || orderbook.highest_buy_order == null
                    ? '-'
                    : formatPrice(orderbook.highest_buy_order);
            $(
                '.market_table_value > span:nth-child(1) > span:nth-child(1) > span:nth-child(1)',
                listingUI,
            ).append(
                ` ➤ <span title="This is likely the highest buy order price.">${
                    highestBuyOrderPrice
                }</span>`,
            );

            logConsole('============================');
            logConsole(JSON.stringify(listing));
            logConsole(`${game_name}: ${asset.name}`);
            logConsole(`Current price: ${price / 100.0}`);

            // Calculate two prices here, one without the offset and one with the offset.
            // The price without the offset is required to not relist the item constantly when you have the lowest price (i.e., with a negative offset).
            // The price with the offset should be used for relisting so it will still apply the user-set offset.
            //
            // Built once and passed to both calls: two independent
            // createPricingRules() calls could in principle read the settings
            // or the wall clock a moment apart and disagree on this one item.
            const rules = createPricingRules();

            const sellPriceWithoutOffset = calculateSellPriceBeforeFees(
                history,
                orderbook,
                false,
                priceInfo.minPriceBeforeFees,
                priceInfo.maxPriceBeforeFees,
                rules,
            );
            const sellPriceWithOffset = calculateSellPriceBeforeFees(
                history,
                orderbook,
                true,
                priceInfo.minPriceBeforeFees,
                priceInfo.maxPriceBeforeFees,
                rules,
            );

            const sellPriceWithoutOffsetWithFees =
                market.getPriceIncludingFees(sellPriceWithoutOffset);

            logConsole(
                `Calculated price: ${sellPriceWithoutOffsetWithFees / 100.0} (${sellPriceWithoutOffset / 100.0})`,
            );

            const verdict = getListingVerdict(sellPriceWithoutOffsetWithFees, price);

            listingState.set(listing.listingid, {
                sellPrice: sellPriceWithOffset,
                verdict: verdict,
            });

            // The verdict is still a class. It styles the listing and it is
            // what the selection buttons match on. The price is not: nothing
            // can style `price_1234` and nothing reads it back any more.
            listingUI.addClass(verdict);

            $('.market_listing_my_price', listingUI)
                .last()
                .prop('title', `The best price is ${formatPrice(sellPriceWithoutOffsetWithFees)}.`);

            $('.market_listing_my_price', listingUI)
                .last()
                .css('background', VERDICT_COLORS[verdict]);

            logConsole(VERDICT_MESSAGES[verdict]);

            if (
                verdict == VERDICT_OVERPRICED &&
                getSettingWithDefault(SETTING_RELIST_AUTOMATICALLY) == 1
            ) {
                queueOverpricedItemListing(listing.listingid);
            }

            return callback(true, cachedHistory && cachedListings);
        });
    });
}

const marketOverpricedQueue = async.queue((item: QueueTask, next) => {
    marketOverpricedQueueWorker(item, false, (success) => {
        const callback = () => {
            marketRelistDone += 1;

            increaseMarketProgress();
            next();
        };

        if (success) {
            setTimeout(callback, getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));
        } else {
            setTimeout(
                () => marketOverpricedQueueWorker(item, true, callback),
                getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
        }
    });
}, 1);

// The relist run is over, put the buttons back to showing the (now lower) overpriced count.
function resetMarketRelistProgress() {
    marketRelistTotal = 0;
    marketRelistDone = 0;
    marketRelistQueuedListings.clear();

    refreshMarketOverpricedButtons();
}

// Automatic relisting feeds this queue while the pricing pass is still finding
// overpriced listings, so it drains every time it happens to catch up with the pass.
// Clearing the progress there restarts the count from zero halfway through the run,
// so the queue that finishes last is the one that clears it.
marketOverpricedQueue.drain(() => {
    if (!marketListingsQueue.idle()) {
        refreshMarketOverpricedButtons();

        return;
    }

    resetMarketRelistProgress();
});

// The other half of the same rule: the pricing pass can finish after the last relist
// it queued is already done, and then nothing else is left to clear the progress.
marketListingsQueue.drain(() => {
    if (!marketOverpricedQueue.idle()) {
        return;
    }

    resetMarketRelistProgress();
});

function marketOverpricedQueueWorker(item, ignoreErrors, callback) {
    let listingUI = getListingFromLists(item.listing);
    if (listingUI == null) {
        logConsole(`Listing ${item.listing} not found in the lists, skipping.`);

        callback(true);

        return;
    }

    listingUI = listingUI.elm;

    market.removeListing(item.listing, false, (errorRemove) => {
        if (!errorRemove) {
            $('.actual_content', listingUI).css('background', COLOR_PENDING);

            setTimeout(
                () => {
                    const itemName = $('.market_listing_item_name_link', listingUI)
                        .first()
                        .attr('href');
                    const marketHashNameIndex = itemName.lastIndexOf('/') + 1;
                    const marketHashName = itemName.substring(marketHashNameIndex);
                    const decodedMarketHashName = decodeURIComponent(
                        itemName.substring(marketHashNameIndex),
                    );
                    let newAssetId = -1;

                    steamPage.requestFullInventory(
                        `${market.inventoryUrl + item.appid}/${item.contextid}/`,
                        (transport) => {
                            if (transport.responseJSON && transport.responseJSON.success) {
                                const inventory = transport.responseJSON.rgInventory;

                                for (const child in inventory) {
                                    if (
                                        marketListingsRelistedAssets.indexOf(child) == -1 &&
                                        inventory[child].appid == item.appid &&
                                        (inventory[child].market_hash_name ==
                                            decodedMarketHashName ||
                                            inventory[child].market_hash_name == marketHashName)
                                    ) {
                                        newAssetId = child;
                                        break;
                                    }
                                }

                                if (newAssetId == -1) {
                                    $('.actual_content', listingUI).css('background', COLOR_ERROR);
                                    return callback(false);
                                }

                                item.assetid = newAssetId;
                                marketListingsRelistedAssets.push(newAssetId);

                                market.sellItem(item, item.sellPrice, (errorSell) => {
                                    if (!errorSell) {
                                        $('.actual_content', listingUI).css(
                                            'background',
                                            COLOR_SUCCESS,
                                        );

                                        setTimeout(() => {
                                            removeListingFromLists(item.listing);
                                        }, 3000);

                                        return callback(true);
                                    } else {
                                        $('.actual_content', listingUI).css(
                                            'background',
                                            COLOR_ERROR,
                                        );
                                        return callback(false);
                                    }
                                });
                            } else {
                                $('.actual_content', listingUI).css('background', COLOR_ERROR);
                                return callback(false);
                            }
                        },
                    );
                },
                getRandomInt(1500, 2500),
            ); // Wait a little to make sure the item is returned to inventory.
        } else {
            $('.actual_content', listingUI).css('background', COLOR_ERROR);
            return callback(false);
        }
    });
}

// Queue an overpriced item listing to be relisted.
// A listing is only queued once, however it was picked: automatic relisting, relist
// overpriced and relist selected all end up here and can well name the same listing.
function queueOverpricedItemListing(listingid) {
    if (marketRelistQueuedListings.has(listingid)) {
        return;
    }

    const assetInfo = getAssetInfoFromListingId(listingid);

    // A listing with no state has not been priced yet, so there is nothing to relist at.
    const state = listingState.get(listingid);
    const price = state == null ? -1 : state.sellPrice;

    if (price > 0) {
        marketOverpricedQueue.push({
            listing: listingid,
            assetid: assetInfo.assetid,
            contextid: assetInfo.contextid,
            appid: assetInfo.appid,
            sellPrice: price,
        });

        marketRelistQueuedListings.add(listingid);
        marketRelistTotal += 1;

        increaseMarketProgressMax();
        refreshMarketOverpricedButtons();
    }
}

const marketRemoveQueue = async.queue((listingid: QueueTask, next) => {
    marketRemoveQueueWorker(listingid, false, (success) => {
        const callback = () => {
            increaseMarketProgress();
            next();
        };

        if (success) {
            setTimeout(callback, getRandomInt(50, 100));
        } else {
            setTimeout(
                () => marketRemoveQueueWorker(listingid, true, callback),
                getRandomInt(RETRY_DELAY_LONG_MIN, RETRY_DELAY_LONG_MAX),
            );
        }
    });
}, 1);

function marketRemoveQueueWorker(listingid, ignoreErrors, callback) {
    const listingUI = getListingFromLists(listingid).elm;
    const isBuyOrder = listingUI.id.startsWith('mybuyorder_');

    market.removeListing(listingid, isBuyOrder, (errorRemove) => {
        if (!errorRemove) {
            $('.actual_content', listingUI).css('background', COLOR_SUCCESS);

            setTimeout(() => {
                removeListingFromLists(listingid);

                const numberOfListings = marketLists[0].size;
                if (numberOfListings > 0) {
                    $('#my_market_selllistings_number').text(numberOfListings.toString());

                    // This seems identical to the number of sell listings.
                    $('#my_market_activelistings_number').text(numberOfListings.toString());
                }
            }, 3000);

            return callback(true);
        } else {
            $('.actual_content', listingUI).css('background', COLOR_ERROR);

            return callback(false);
        }
    });
}

const marketListingsItemsQueue = async.queue((listing: QueueTask, next) => {
    const callback = () => {
        increaseMarketProgress();
        setTimeout(() => next(), getRandomInt(RETRY_DELAY_SHORT_MIN, RETRY_DELAY_SHORT_MAX));
    };

    const url = `${window.location.origin}/market/mylistings`;

    const options = {
        method: 'GET',
        data: {
            count: 100,
            start: listing,
        },
        responseType: 'json',
    };

    request(url, options, (error, data) => {
        if (error || !data?.success) {
            callback();
            return;
        }

        const myMarketListings = $('#tabContentsMyActiveMarketListingsRows');

        const nodes = $.parseHTML(data.results_html);
        const rows = $('.market_listing_row', nodes);
        myMarketListings.append(rows);

        // g_rgAssets
        steamPage.mergeAssets(data.assets); // This is a method from Steam.

        callback();
    });
}, 1);

marketListingsItemsQueue.drain(() => {
    const myMarketListings = $('#tabContentsMyActiveMarketListingsRows');
    myMarketListings.checkboxes('range', true);

    // Sometimes the Steam API is returning duplicate entries (especially during item listing), filter these.
    const seen = {};
    $('.market_listing_row', myMarketListings).each(function () {
        const item_id = $(this).attr('id');
        if (seen[item_id]) {
            $(this).remove();
        } else {
            seen[item_id] = true;
        }

        // Remove listings awaiting confirmations, they are already listed separately.
        if (
            $('.item_market_action_button', this)
                .attr('href')
                .toLowerCase()
                .includes('CancelMarketListingConfirmation'.toLowerCase())
        ) {
            $(this).remove();
        }

        // Remove buy order listings, they are already listed separately.
        if (
            $('.item_market_action_button', this)
                .attr('href')
                .toLowerCase()
                .includes('CancelMarketBuyOrder'.toLowerCase())
        ) {
            $(this).remove();
        }
    });

    // Now add the market checkboxes.
    addMarketCheckboxes();

    // Show the listings again, rendering is done.
    removeSpinner();

    myMarketListings.show();

    fillMarketListingsQueue();
});

function fillMarketListingsQueue() {
    $('.market_home_listing_table').each(function (e) {
        // Not for popular / new / recently sold items (bottom of page).
        if ($('.my_market_header', $(this)).length == 0) {
            return;
        }

        // Buy orders and listings confirmations are not grouped like the sell listings, add this so pagination works there as well.
        if (!$(this).attr('id')) {
            $(this).attr('id', `market-listing-${e}`);

            $(this).append(
                `<div class="market_listing_see" id="market-listing-container-${e}"></div>`,
            );
            $('.market_listing_row', $(this)).appendTo($(`#market-listing-container-${e}`));
        } else {
            $(this).children().last().addClass('market_listing_see');
        }

        const marketListing = $('.market_listing_see', this).last();
        if (marketListing[0].childElementCount > 0) {
            addMarketListings(marketListing);
            sortMarketListings($(this), false, false, true);
        }
    });

    let totalSellOrderPriceBuyer = 0;
    let totalSellOrderPriceSeller = 0;
    let totalSellOrderAmount = 0;

    let totalBuyOrderPrice = 0;
    let totalBuyOrderAmount = 0;

    // Add the listings to the queue to be checked for the price.
    marketLists
        .flatMap((list) => list.items)
        .forEach((item) => {
            const isBuyOrder =
                item.elm.id.startsWith('mbuyorder_') || item.elm.id.startsWith('mybuyorder_');
            const isSellOrder = item.elm.id.startsWith('mylisting_');

            if (isSellOrder) {
                const listingid = replaceNonNumbers(item.values().market_listing_item_name);
                const assetInfo = getAssetInfoFromListingId(listingid);

                if (assetInfo.appid === undefined) {
                    logConsole(`Skipping listing ${listingid} (appid not found)`);
                    return;
                }

                totalSellOrderAmount += assetInfo.amount;

                if (!isNaN(assetInfo.priceBuyer)) {
                    totalSellOrderPriceBuyer += assetInfo.priceBuyer * assetInfo.amount;
                }
                if (!isNaN(assetInfo.priceSeller)) {
                    totalSellOrderPriceSeller += assetInfo.priceSeller * assetInfo.amount;
                }

                marketListingsQueue.push({
                    listingid,
                    appid: assetInfo.appid,
                    contextid: assetInfo.contextid,
                    assetid: assetInfo.assetid,
                });

                return;
            }

            if (isBuyOrder) {
                const listingid = replaceNonNumbers(item.values().market_listing_item_name);
                const assetInfo = getAssetInfoFromBuyOrderId(listingid);

                if (assetInfo.amount === undefined) {
                    logConsole(`Skipping listing ${listingid} (amount not found)`);
                    return;
                }

                totalBuyOrderAmount += assetInfo.amount;

                if (!isNaN(assetInfo.price)) {
                    totalBuyOrderPrice += assetInfo.price * assetInfo.amount;
                }

                return;
            }

            logConsole(`Skipping item ${item.elm.id} (not a buy or sell order)`);
        });

    if (totalSellOrderAmount > 0) {
        increaseMarketProgressMax();
    }

    $('#my_market_selllistings_number')
        .append(`<span id="my_market_sell_listings_total_amount"> [${totalSellOrderAmount}]</span>`)
        .append(
            `<span id="my_market_sell_listings_total_price">, ${formatPrice(totalSellOrderPriceBuyer)} ➤ ${formatPrice(totalSellOrderPriceSeller)}</span>`,
        );

    $('#my_market_buylistings_number')
        .append(`<span id="my_market_buy_listings_total_amount"> [${totalBuyOrderAmount}]</span>`)
        .append(
            `<span id="my_market_buy_listings_total_price">, ${formatPrice(totalBuyOrderPrice)}</span>`,
        );
}

// Gets the asset info (appid/contextid/assetid) based on a listingid.
function getAssetInfoFromListingId(listingid) {
    const listing = getListingFromLists(listingid);
    if (listing == null) {
        return {};
    }

    const actionButton = $('.item_market_action_button', listing.elm).attr('href');
    // Market buy orders have no asset info.
    if (actionButton == null || actionButton.toLowerCase().includes('cancelmarketbuyorder')) {
        return {};
    }

    const priceBuyer = getPriceValueAsInt(
        $('.market_listing_price > span:nth-child(1) > span:nth-child(1)', listing.elm).text(),
    );
    const priceSeller = getPriceValueAsInt(
        $('.market_listing_price > span:nth-child(1) > span:nth-child(3)', listing.elm).text(),
    );
    const itemIds = actionButton.split(',');
    const appid = replaceNonNumbers(itemIds[2]);
    const contextid = replaceNonNumbers(itemIds[3]);
    const assetid = replaceNonNumbers(itemIds[4]);
    const amount = Number(steamPage.assetFor(appid, contextid, assetid)?.amount ?? 1);
    return {
        appid,
        contextid,
        assetid,
        amount,
        priceBuyer,
        priceSeller,
    };
}

function getAssetInfoFromBuyOrderId(orderid) {
    const listing = getListingFromLists(orderid);

    if (listing == null) {
        return {};
    }

    if (!listing.elm.id.startsWith('mbuyorder_') && !listing.elm.id.startsWith('mybuyorder_')) {
        return {};
    }

    const amount = parseInt($('.market_listing_buyorder_qty', listing.elm).text().trim());
    const price = getPriceValueAsInt($('.market_listing_price', listing.elm)[0].innerText);

    return { amount, price };
}

// Adds market item listings.
function addMarketListings(market_listing_see) {
    market_listing_see.addClass('list');

    $('.market_listing_table_header', market_listing_see.parent()).append(
        '<input class="search" id="market_name_search" placeholder="Search..." />',
    );

    const options = {
        valueNames: [
            'market_listing_game_name',
            'market_listing_item_name_link',
            'market_listing_price',
            'market_listing_listed_date',
            {
                name: 'market_listing_item_name',
                attr: 'id',
            },
        ],
    };

    try {
        const list = new List(market_listing_see.parent().get(0), options);
        list.on('searchComplete', updateMarketSelectAllButton);
        list.on('searchComplete', refreshMarketOverpricedButtons);
        marketLists.push(list);
    } catch (e) {
        console.error(e);
    }
}

// Adds checkboxes to market listings.
function addMarketCheckboxes() {
    $('.market_listing_row').each(function () {
        // Don't add it again, one time is enough.
        if ($('.market_listing_select', this).length == 0) {
            $('.market_listing_cancel_button', $(this)).append(
                '<div class="market_listing_select">' +
                    '<input type="checkbox" class="market_select_item"/>' +
                    '</div>',
            );

            $('.market_select_item', this).change(() => {
                updateMarketSelectAllButton();
            });
        }
    });
}

// Process the market listings.
function processMarketListings() {
    addMarketCheckboxes();

    if (currentPage == PAGE_MARKET) {
        // Load the market listings.
        let currentCount = 0;
        let totalCount = 0;

        const myListingsTotalCount = steamPage.myListingsTotalCount();
        if (myListingsTotalCount != null) {
            totalCount = myListingsTotalCount;
        } else {
            totalCount = parseInt($('#my_market_selllistings_number').text());
        }

        if (isNaN(totalCount) || totalCount == 0) {
            fillMarketListingsQueue();
            return;
        }

        $('#tabContentsMyActiveMarketListingsRows').html(''); // Clear the default listings.
        $('#tabContentsMyActiveMarketListingsRows').hide(); // Hide all listings until everything has been loaded.

        // Hide Steam's paging controls.
        $('#tabContentsMyActiveMarketListings_ctn').hide();
        $('.market_pagesize_options').hide();

        // Show the spinner so the user knows that something is going on.
        renderSpinner('Loading market listings');

        while (currentCount < totalCount) {
            marketListingsItemsQueue.push(currentCount);
            increaseMarketProgressMax();
            currentCount += 100;
        }
    } else {
        // This is on a market item page.
        $('.market_home_listing_table').each(function () {
            // Not on 'x requests to buy at y,yy or lower'.
            if ($('#market_buyorder_info_show_details', $(this)).length > 0) {
                return;
            }

            $(this).children().last().wrap('<div class="market_listing_see"></div>');
            const marketListing = $('.market_listing_see', this).last();
            const container = $('.market_listing_row', marketListing)?.parent();

            if (
                marketListing[0]?.childElementCount > 0 &&
                container != null &&
                container.length > 0
            ) {
                addMarketListings(container);
                sortMarketListings($(this), false, false, true);
            }
        });

        $('#tabContentsMyActiveMarketListingsRows > .market_listing_row').each(function () {
            const listingid = $(this)
                .attr('id')
                .replace('mylisting_', '')
                .replace('mybuyorder_', '')
                .replace('mbuyorder_', '');
            const assetInfo = getAssetInfoFromListingId(listingid);

            // There's only one item in the g_rgAssets on a market listing page.
            const existingAsset = steamPage.firstAsset();

            // appid and contextid are identical, only the assetid is different for each asset.
            steamPage.setAsset(
                assetInfo.appid,
                assetInfo.contextid,
                assetInfo.assetid,
                existingAsset,
            );
            marketListingsQueue.push({
                listingid,
                appid: assetInfo.appid,
                contextid: assetInfo.contextid,
                assetid: assetInfo.assetid,
            });
            increaseMarketProgressMax();
        });
    }
}

// Update the select/deselect all button on the market.
function updateMarketSelectAllButton() {
    $('.market_listing_buttons').each(function () {
        const selectionGroup = $(this).parent().parent();
        let invert =
            $('.market_select_item:checked', selectionGroup).length ==
            $('.market_select_item', selectionGroup).length;
        if ($('.market_select_item', selectionGroup).length == 0) {
            // If there are no items to select, keep it at Select all.
            invert = false;
        }
        $('.select_all > span', selectionGroup).text(invert ? 'Deselect all' : 'Select all');
    });
}

// Shows the number of overpriced listings on the overpriced buttons.
// The count is taken from the matching items so it reflects exactly what the buttons act on,
// which means it follows the search filter.
//
// While a relist run is in progress the relist overpriced button shows the progress of the
// shared relist queue instead of the count, and is marked busy because everything it would
// queue is already queued. Relist selected is left alone: it acts on a hand-picked
// selection, which is not what a run started somewhere else is working through.
function updateMarketOverpricedButtons() {
    const isRelisting = marketRelistTotal > 0;

    $('.market_listing_buttons').each(function () {
        const selectionGroup = $(this).parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        const count = marketList.matchingItems.filter((item) =>
            $(item.elm).hasClass(VERDICT_OVERPRICED),
        ).length;

        $('.relist_overpriced > span', selectionGroup).text(
            isRelisting
                ? `Relisting ${marketRelistDone}/${marketRelistTotal}`
                : `Relist overpriced (${count})`,
        );

        $('.relist_overpriced', selectionGroup).toggleClass('see_button_busy', isRelisting);

        $('.select_overpriced > span', selectionGroup).text(`Select overpriced (${count})`);
    });
}

// Sort the market listings.
function sortMarketListings(elem, isPrice, isDateOrQuantity, isName) {
    const list = getListFromContainer(elem);
    if (list == null) {
        logConsole('Invalid parameter, could not find a list matching elem.');
        return;
    }

    // Change sort order (asc/desc).
    let asc = true;

    // (Re)set the asc/desc arrows.
    const arrow_down = '▼';
    const arrow_up = '▲';

    $('.market_listing_table_header > span', elem).each(function () {
        if ($(this).hasClass('market_listing_edit_buttons')) {
            return;
        }

        if ($(this).text().includes(arrow_up)) {
            asc = false;
        }

        $(this).text($(this).text().replace(` ${arrow_down}`, '').replace(` ${arrow_up}`, ''));
    });

    let market_listing_selector;
    if (isPrice) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(1);
    } else if (isDateOrQuantity) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(2);
    } else if (isName) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(3);
    }
    market_listing_selector.text(
        `${market_listing_selector.text()} ${asc ? arrow_up : arrow_down}`,
    );

    if (list.sort == null) {
        return;
    }

    const isBuyOrder = list.list.querySelectorAll('.market_listing_buyorder_qty').length >= 1;

    if (isName) {
        list.sort('', {
            order: asc ? 'asc' : 'desc',
            sortFunction: function (a, b) {
                if (
                    a
                        .values()
                        .market_listing_game_name.toLowerCase()
                        .localeCompare(b.values().market_listing_game_name.toLowerCase()) == 0
                ) {
                    return a
                        .values()
                        .market_listing_item_name_link.toLowerCase()
                        .localeCompare(b.values().market_listing_item_name_link.toLowerCase());
                }
                return a
                    .values()
                    .market_listing_game_name.toLowerCase()
                    .localeCompare(b.values().market_listing_game_name.toLowerCase());
            },
        });
    } else if (isDateOrQuantity) {
        const currentMonth = luxon.DateTime.local().month;

        if (isBuyOrder) {
            list.sort('market_listing_buyorder_qty', {
                order: asc ? 'asc' : 'desc',
                sortFunction: function (a, b) {
                    const quantityA = a.elm.querySelector('.market_listing_buyorder_qty').innerText;
                    const quantityB = b.elm.querySelector('.market_listing_buyorder_qty').innerText;

                    return quantityA - quantityB;
                },
            });
        } else {
            list.sort('market_listing_listed_date', {
                order: asc ? 'asc' : 'desc',
                sortFunction: function (a, b) {
                    let firstDate = luxon.DateTime.fromString(
                        a.values().market_listing_listed_date.trim(),
                        'd MMM',
                    );
                    let secondDate = luxon.DateTime.fromString(
                        b.values().market_listing_listed_date.trim(),
                        'd MMM',
                    );

                    if (firstDate == null || secondDate == null) {
                        return 0;
                    }

                    if (firstDate.month > currentMonth) {
                        firstDate = firstDate.plus({ years: -1 });
                    }
                    if (secondDate.month > currentMonth) {
                        secondDate = secondDate.plus({ years: -1 });
                    }

                    if (firstDate > secondDate) {
                        return 1;
                    }
                    if (firstDate === secondDate) {
                        return 0;
                    }
                    return -1;
                },
            });
        }
    } else if (isPrice) {
        list.sort('market_listing_price', {
            order: asc ? 'asc' : 'desc',
            sortFunction: function (a, b) {
                if (!isBuyOrder) {
                    let listingPriceA = $(a.values().market_listing_price).text();
                    listingPriceA = listingPriceA.substr(0, listingPriceA.indexOf('('));

                    let listingPriceB = $(b.values().market_listing_price).text();
                    listingPriceB = listingPriceB.substr(0, listingPriceB.indexOf('('));

                    const firstPrice = getPriceValueAsInt(listingPriceA);
                    const secondPrice = getPriceValueAsInt(listingPriceB);

                    return firstPrice - secondPrice;
                } else {
                    const priceA = getPriceValueAsInt(
                        a.elm.querySelector(
                            'div:nth-child(3) > span:nth-child(1) > span:nth-child(1)',
                        ).innerText,
                    );
                    const priceB = getPriceValueAsInt(
                        b.elm.querySelector(
                            'div:nth-child(3) > span:nth-child(1) > span:nth-child(1)',
                        ).innerText,
                    );

                    return priceA - priceB;
                }
            },
        });
    }
}

function getListFromContainer(group) {
    for (let i = 0; i < marketLists.length; i++) {
        if (group[0].contains(marketLists[i].listContainer)) {
            return marketLists[i];
        }
    }
}

function getListingFromLists(listingid) {
    // Sometimes listing ids are contained in multiple lists (?), use the last one available as this is the one we're most likely interested in.
    for (let i = marketLists.length - 1; i >= 0; i--) {
        let values = marketLists[i].get('market_listing_item_name', `mylisting_${listingid}_name`);
        if (values != null && values.length > 0) {
            return values[0];
        }

        values = marketLists[i].get('market_listing_item_name', `mbuyorder_${listingid}_name`);
        if (values != null && values.length > 0) {
            return values[0];
        }
    }
}

function removeListingFromLists(listingid) {
    for (let i = 0; i < marketLists.length; i++) {
        marketLists[i].remove('market_listing_item_name', `mylisting_${listingid}_name`);
        marketLists[i].remove('market_listing_item_name', `mbuyorder_${listingid}_name`);
    }

    // Listings are removed from the lists a few seconds after they are relisted or removed,
    // which can be after the queue drained, so refresh the counts here as well.
    refreshMarketOverpricedButtons();
}

// Initialize the market UI.
function initializeMarketUI() {
    $('.market_header_text').append('<progress id="see_market_progress" value="1" max="1" hidden>');
    marketProgressBar = document.getElementById('see_market_progress');

    // Sell orders.
    // Steam prepends a "listings awaiting confirmation" block whenever a confirmation is pending,
    // so the sell listings are not always the first header. steamPage.sellListingsHeader()
    // anchors to the sell listings table itself and falls back to the first header only if
    // that table cannot be found - see pickSellListingsHeader for why the fallback matters.
    const sellListingsHeader = steamPage.sellListingsHeader();

    sellListingsHeader.append(`<div class="market_listing_buttons">
        <a class="item_market_action_button item_market_action_button_green select_all market_listing_button">
            <span class="item_market_action_button_contents">Select all</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_five_from_page market_listing_button">
            <span class="item_market_action_button_contents">Select 5</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_twentyfive_from_page market_listing_button">
            <span class="item_market_action_button_contents">Select 25</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green remove_selected market_listing_button">
            <span class="item_market_action_button_contents">Remove selected</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green relist_selected market_listing_button" style="margin-left:auto">
            <span class="item_market_action_button_contents">Relist selected</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green relist_overpriced market_listing_button">
            <span class="item_market_action_button_contents">Relist overpriced (0)</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green select_overpriced market_listing_button">
            <span class="item_market_action_button_contents">Select overpriced (0)</span>
        </a>
    </div>`);

    // Listings confirmations and buy orders.
    $('.my_market_header').not(sellListingsHeader).append(`<div class="market_listing_buttons">
        <a class="item_market_action_button item_market_action_button_green select_all market_listing_button">
            <span class="item_market_action_button_contents">Select all</span>
        </a>
        <a class="item_market_action_button item_market_action_button_green remove_selected market_listing_button">
            <span class="item_market_action_button_contents">Remove selected</span>
        </a>
    </div>`);

    $('.market_listing_table_header').on('click', 'span', function () {
        if (
            $(this).hasClass('market_listing_edit_buttons') ||
            $(this).hasClass('item_market_action_button_contents')
        ) {
            return;
        }

        const isPrice =
            $('.market_listing_table_header', $(this).parent().parent()).children().eq(1).text() ==
            $(this).text();
        const isDate =
            $('.market_listing_table_header', $(this).parent().parent()).children().eq(2).text() ==
            $(this).text();
        const isName =
            $('.market_listing_table_header', $(this).parent().parent()).children().eq(3).text() ==
            $(this).text();

        sortMarketListings($(this).parent().parent(), isPrice, isDate, isName);
    });

    $('.select_all').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        const invert =
            $('.market_select_item:checked', selectionGroup).length ==
            $('.market_select_item', selectionGroup).length;

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', !invert);
        }

        updateMarketSelectAllButton();
    });

    $('.select_five_from_page').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        let count = 0;
        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if (count == 5) {
                break;
            }
            if (!$('.market_select_item', marketList.matchingItems[i].elm).prop('checked')) {
                $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', true);
                count += 1;
            }
        }

        updateMarketSelectAllButton();
    });

    $('.select_twentyfive_from_page').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        let count = 0;
        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if (count == 25) {
                break;
            }
            if (!$('.market_select_item', marketList.matchingItems[i].elm).prop('checked')) {
                $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', true);
                count += 1;
            }
        }

        updateMarketSelectAllButton();
    });

    $('.select_overpriced').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if ($(marketList.matchingItems[i].elm).hasClass(VERDICT_OVERPRICED)) {
                $('.market_select_item', marketList.matchingItems[i].elm).prop('checked', true);
            }
        }

        $('.market_listing_row', selectionGroup).each(function () {
            if ($(this).hasClass(VERDICT_OVERPRICED)) {
                $('.market_select_item', $(this)).prop('checked', true);
            }
        });

        updateMarketSelectAllButton();
    });

    $('.remove_selected').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if ($('.market_select_item', $(marketList.matchingItems[i].elm)).prop('checked')) {
                const listingid = replaceNonNumbers(
                    marketList.matchingItems[i].values().market_listing_item_name,
                );

                const listingUI = $(getListingFromLists(listingid).elm);
                listingUI.addClass('removing');

                marketRemoveQueue.push(listingid);
                increaseMarketProgressMax();
            }
        }
    });

    $('.market_relist_auto').change(() => {
        setSetting(SETTING_RELIST_AUTOMATICALLY, $('.market_relist_auto').is(':checked') ? 1 : 0);
    });

    $('.relist_overpriced').on('click', '*', function () {
        if ($(this).closest('.relist_overpriced').hasClass('see_button_busy')) {
            return;
        }

        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if ($(marketList.matchingItems[i].elm).hasClass(VERDICT_OVERPRICED)) {
                const listingid = replaceNonNumbers(
                    marketList.matchingItems[i].values().market_listing_item_name,
                );
                queueOverpricedItemListing(listingid);
            }
        }
    });

    $('.relist_selected').on('click', '*', function () {
        const selectionGroup = $(this).parent().parent().parent().parent();
        const marketList = getListFromContainer(selectionGroup);

        if (marketList == null) {
            return;
        }

        for (let i = 0; i < marketList.matchingItems.length; i++) {
            if (
                $(marketList.matchingItems[i].elm) &&
                $('.market_select_item', $(marketList.matchingItems[i].elm)).prop('checked')
            ) {
                const listingid = replaceNonNumbers(
                    marketList.matchingItems[i].values().market_listing_item_name,
                );
                queueOverpricedItemListing(listingid);
            }
        }
    });

    $('#see_settings').remove();
    $('#global_action_menu').prepend(
        '<span id="see_settings"><a href="javascript:void(0)">⬖ Steam Economy Enhancer</a></span>',
    );
    $('#see_settings').on('click', '*', () => openSettings());

    processMarketListings();
    initializeMarketHistoryUI();
}

// Initialize the market history UI.
function initializeMarketHistoryUI() {
    // Use jquery-observe (already included in SEE) to listen for AJAX DOM updates
    $('#tabContentsMyMarketHistory').observe('childlist subtree', () => {
        const controlsDiv = $('#tabContentsMyMarketHistory_controls');

        // Ensure the controls exist and we haven't already injected our jumper
        if (controlsDiv.length > 0 && $('#see_page_jump').length === 0) {
            const jumpContainer = $('<span id="see_page_jump"></span>');
            const input = $('<input type="number" min="1" placeholder="Page" />');
            const btn = $(
                '<span class="btn_green_white_innerfade btn_small" style="cursor: pointer;"><span>Jump</span></span>',
            );

            jumpContainer.append(input).append(btn);
            controlsDiv.append(jumpContainer);

            btn.on('click', () => {
                const targetPage = parseInt(input.val());
                if (isNaN(targetPage) || targetPage < 1) {
                    return; // Fail silently
                }
                const targetIndex = targetPage - 1;

                steamPage.goToHistoryPage(targetIndex);
            });

            input.on('keypress', (e) => {
                if (e.which === 13) {
                    // Enter key
                    btn.click();
                }
            });
        }
    });
}
//#endregion

//#region Tradeoffers
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_TRADEOFFER
// Gets the trade offer's inventory items from the active inventory.
function getTradeOfferInventoryItems() {
    return readInventoryItems(getActiveInventory(), 'rgChildInventories', 'rgInventory');
}

// side is 'me' or 'them' - see steamPage.tradeAssets/findTradeAsset.
function sumTradeOfferAssets(side) {
    // What the offer holds and what it is worth. The prices come from the state the
    // inventory pass wrote, not from the class names on the item elements.
    const summary = aggregateTradeOfferAssets(steamPage.tradeAssets(side), (asset) => {
        const rgItem = steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid);

        if (rgItem == null) {
            return null;
        }

        const state = listingState.get(getAssetKey(rgItem));

        return {
            name: rgItem.name,
            type: rgItem.type,
            originalAmount: rgItem.original_amount,
            amount: rgItem.amount,
            price: state == null ? 0 : state.sellPrice,
        };
    });

    const sortable = summary.items.map((item) => [item.text, item.count]);

    sortable
        .sort((a, b) => {
            return a[1] - b[1];
        })
        .reverse();

    let totalText = `<strong>Number of unique items: ${sortable.length}, worth ${formatPrice(summary.totalPrice)}<br/><br/></strong>`;
    let totalNumOfItems = 0;
    for (let i = 0; i < sortable.length; i++) {
        totalText += `${sortable[i][1]}x ${sortable[i][0]}<br/>`;
        totalNumOfItems += sortable[i][1];
    }
    totalText += `<br/><strong>Total items: ${totalNumOfItems}</strong><br/>`;

    return totalText;
}

let lastTradeOfferSum = 0;

// Both sides of a trade are walked the same way, by the same two steamPage calls, in
// four different places. TRADE_SIDES is that walk, done once each time instead of once
// per side per place.
const TRADE_SIDES = ['them', 'me'];

function tradeItemsFor(side) {
    return steamPage
        .tradeAssets(side)
        .map((asset) =>
            steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid),
        );
}

function hasLoadedAllTradeOfferItems() {
    return TRADE_SIDES.every((side) => tradeItemsFor(side).every((asset) => asset != null));
}

function initializeTradeOfferUI() {
    if (getSettingWithDefault(SETTING_TRADEOFFER_PRICE_LABELS) == 1) {
        const updateInventoryPrices = function () {
            setInventoryPrices(getTradeOfferInventoryItems());
        };

        const updateInventoryPricesInTrade = function () {
            setInventoryPrices(TRADE_SIDES.flatMap((side) => tradeItemsFor(side)));
        };

        $('.trade_right > div > div > div > .trade_item_box').observe('childlist subtree', () => {
            if (!hasLoadedAllTradeOfferItems()) {
                return;
            }

            const currentTradeOfferSum = TRADE_SIDES.reduce(
                (total, side) => total + steamPage.tradeAssets(side).length,
                0,
            );
            if (lastTradeOfferSum != currentTradeOfferSum) {
                updateInventoryPricesInTrade();
            }

            lastTradeOfferSum = currentTradeOfferSum;

            $('#trade_offer_your_sum').remove();
            $('#trade_offer_their_sum').remove();

            const your_sum = sumTradeOfferAssets('me');
            const their_sum = sumTradeOfferAssets('them');

            $('div.offerheader:nth-child(1) > div:nth-child(3)').append(
                `<div class="trade_offer_sum" id="trade_offer_your_sum">${your_sum}</div>`,
            );
            $('div.offerheader:nth-child(3) > div:nth-child(3)').append(
                `<div class="trade_offer_sum" id="trade_offer_their_sum">${their_sum}</div>`,
            );
        });

        // Load after the inventory is loaded.
        updateInventoryPrices();

        $('#pagecontrol_cur').observe('childlist', () => {
            updateInventoryPrices();
        });
    }

    const appendSelectPageButton = () => {
        $('#inventory_displaycontrols').append(`<div class="trade_offer_buttons">
          <a class="item_market_action_button item_market_action_button_green select_all">
              <span class="item_market_action_button_contents" style="text-transform:none">Select all from page</span>
          </a>
      </div>`);

        $('.select_all').on('click', '*', () => {
            $('.inventory_ctn:visible > .inventory_page:visible > .itemHolder:visible').delayedEach(
                250,
                (i, it) => {
                    const item = it.rgItem;
                    if (item.is_stackable) {
                        return;
                    }

                    if (!item.tradable) {
                        return;
                    }

                    steamPage.moveItemToTrade(it);
                },
            );
        });
    };

    // On counter offers, we need to wait until 'Change offer' is pressed
    if (location.pathname !== '/tradeoffer/new/' && location.pathname !== '/tradeoffer/new') {
        $('.modify_trade_offer').one('click', '*', () => {
            appendSelectPageButton();
        });
    } else {
        appendSelectPageButton();
    }
}
//#endregion

//#region Settings
function openSettings() {
    const price_options = $(`<div id="see_settings_modal">
        <div>
            Calculate prices as the:&nbsp;
            <select id="${SETTING_PRICE_ALGORITHM}">
                <option value="1"${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 1 ? 'selected="selected"' : ''}>Maximum of the average history and lowest sell listing</option>
                <option value="2" ${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 2 ? 'selected="selected"' : ''}>Lowest sell listing</option>
                <option value="3" ${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 3 ? 'selected="selected"' : ''}>Highest current buy order or lowest sell listing</option>
                <option value="4" ${getSettingWithDefault(SETTING_PRICE_ALGORITHM) == 4 ? 'selected="selected"' : ''}>Average history only</option>
            </select>
        </div>
        <div style="margin-top:6px;">
            Hours to use for the average history calculated price:&nbsp;
            <input type="number" min="0" step="2" id="${SETTING_PRICE_HISTORY_HOURS}" value=${getSettingWithDefault(SETTING_PRICE_HISTORY_HOURS)}>
        </div>
        <div style="margin-top:6px;">
            The value to add to the calculated price (minimum and maximum are respected):&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_OFFSET}" value=${getSettingWithDefault(SETTING_PRICE_OFFSET)}>
        </div>
        <div style="margin-top:6px">
            Use the second lowest sell listing when the lowest sell listing has a low quantity:&nbsp;
            <input type="checkbox" id="${SETTING_PRICE_IGNORE_LOWEST_Q}" ${getSettingWithDefault(SETTING_PRICE_IGNORE_LOWEST_Q) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px;">
            Don't check market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_CHECK_PRICE}" value=${getSettingWithDefault(SETTING_PRICE_MIN_CHECK_PRICE)}>
        </div>
        <div style="margin-top:6px;">
            Don't list market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_LIST_PRICE}" value=${getSettingWithDefault(SETTING_PRICE_MIN_LIST_PRICE)}>
        </div>
        <div style="margin-top:24px">
            Show price labels in inventory:&nbsp;
            <input type="checkbox" id="${SETTING_INVENTORY_PRICE_LABELS}" ${getSettingWithDefault(SETTING_INVENTORY_PRICE_LABELS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px">
            Show price labels in trade offers:&nbsp;
            <input type="checkbox" id="${SETTING_TRADEOFFER_PRICE_LABELS}" ${getSettingWithDefault(SETTING_TRADEOFFER_PRICE_LABELS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px">
            Show quick sell info and buttons:&nbsp;
            <input type="checkbox" id="${SETTING_QUICK_SELL_BUTTONS}" ${getSettingWithDefault(SETTING_QUICK_SELL_BUTTONS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:24px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_NORMAL_PRICE}" value=${getSettingWithDefault(SETTING_MIN_NORMAL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_NORMAL_PRICE}" value=${getSettingWithDefault(SETTING_MAX_NORMAL_PRICE)}>
            &nbsp;price for normal cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_FOIL_PRICE}" value=${getSettingWithDefault(SETTING_MIN_FOIL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_FOIL_PRICE}" value=${getSettingWithDefault(SETTING_MAX_FOIL_PRICE)}>
            &nbsp;price for foil cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_MISC_PRICE}" value=${getSettingWithDefault(SETTING_MIN_MISC_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_MISC_PRICE}" value=${getSettingWithDefault(SETTING_MAX_MISC_PRICE)}>
            &nbsp;price for other items
        </div>
        <div style="margin-top:6px;">
            Automatically relist overpriced market listings (slow on large inventories):&nbsp;
            <input id="${SETTING_RELIST_AUTOMATICALLY}" class="market_relist_auto" type="checkbox" ${getSettingWithDefault(SETTING_RELIST_AUTOMATICALLY) == 1 ? 'checked' : ''}>
        </div>
    </div>`);

    steamPage.showConfirmDialog('Steam Economy Enhancer', price_options).done(() => {
        setSetting(
            SETTING_MIN_NORMAL_PRICE,
            $(`#${SETTING_MIN_NORMAL_PRICE}`, price_options).val(),
        );
        setSetting(
            SETTING_MAX_NORMAL_PRICE,
            $(`#${SETTING_MAX_NORMAL_PRICE}`, price_options).val(),
        );
        setSetting(SETTING_MIN_FOIL_PRICE, $(`#${SETTING_MIN_FOIL_PRICE}`, price_options).val());
        setSetting(SETTING_MAX_FOIL_PRICE, $(`#${SETTING_MAX_FOIL_PRICE}`, price_options).val());
        setSetting(SETTING_MIN_MISC_PRICE, $(`#${SETTING_MIN_MISC_PRICE}`, price_options).val());
        setSetting(SETTING_MAX_MISC_PRICE, $(`#${SETTING_MAX_MISC_PRICE}`, price_options).val());
        setSetting(SETTING_PRICE_OFFSET, $(`#${SETTING_PRICE_OFFSET}`, price_options).val());
        setSetting(
            SETTING_PRICE_MIN_CHECK_PRICE,
            $(`#${SETTING_PRICE_MIN_CHECK_PRICE}`, price_options).val(),
        );
        setSetting(
            SETTING_PRICE_MIN_LIST_PRICE,
            $(`#${SETTING_PRICE_MIN_LIST_PRICE}`, price_options).val(),
        );
        setSetting(SETTING_PRICE_ALGORITHM, $(`#${SETTING_PRICE_ALGORITHM}`, price_options).val());
        setSetting(
            SETTING_PRICE_IGNORE_LOWEST_Q,
            $(`#${SETTING_PRICE_IGNORE_LOWEST_Q}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_PRICE_HISTORY_HOURS,
            $(`#${SETTING_PRICE_HISTORY_HOURS}`, price_options).val(),
        );
        setSetting(
            SETTING_RELIST_AUTOMATICALLY,
            $(`#${SETTING_RELIST_AUTOMATICALLY}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_INVENTORY_PRICE_LABELS,
            $(`#${SETTING_INVENTORY_PRICE_LABELS}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_TRADEOFFER_PRICE_LABELS,
            $(`#${SETTING_TRADEOFFER_PRICE_LABELS}`, price_options).prop('checked') ? 1 : 0,
        );
        setSetting(
            SETTING_QUICK_SELL_BUTTONS,
            $(`#${SETTING_QUICK_SELL_BUTTONS}`, price_options).prop('checked') ? 1 : 0,
        );

        window.location.reload();
    });
}
//#endregion

//#region UI
injectCss(`
    .ui-selected { outline: 2px dashed #FFFFFF; }
    #logger { color: #767676; font-size: 12px;margin-top:16px; max-height: 200px; overflow-y: auto; }
    .trade_offer_sum { color: #767676; font-size: 12px; margin-top:8px; user-select: text; }
    .trade_offer_buttons { margin-top: 12px; }
    .market_commodity_orders_table { font-size:12px; font-family: "Motiva Sans", Sans-serif; font-weight: 300; }
    .market_commodity_orders_table th { padding-left: 10px; }
    #listings_group { display: flex; justify-content: space-between; margin-bottom: 8px; }
    #listings_sell { text-align: right; color: #589328; font-weight:600; }
    #listings_buy { text-align: right; color: #589328; font-weight:600; }
    .market_listing_my_price { height: 50px; padding-right:6px; }
    .market_listing_edit_buttons.actual_content { width:276px; transition-property: background-color, border-color; transition-timing-function: linear; transition-duration: 0.5s;}
    .market_listing_buttons { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 6px; padding: 5px; background: rgba(0, 0, 0, 0.4); }
    .market_listing_label_right { float:right; font-size:12px; margin-top:1px; }
    .market_listing_select { position: absolute; top: 16px;right: 10px; display: flex; }
    #market_listing_relist { vertical-align: middle; position: relative; bottom: -1px; right: 2px; }
    .pick_and_sell_button > a { vertical-align: middle; }
    .market_relist_auto { margin-bottom: 8px;  }
    .market_relist_auto_label { margin-right: 6px; }
    .quick_sell { margin-right: 4px; }

    .spinner {margin:10px auto;width:50px;height:40px;text-align:center;font-size:10px;}
    .spinner > div {background-color:#ccc;height:100%;width:6px;display:inline-block;animation:sk-stretchdelay 1.2s infinite ease-in-out}
    .spinner .rect2 {animation-delay:-1.1s}
    .spinner .rect3 {animation-delay:-1s}
    .spinner .rect4 {animation-delay:-.9s}
    .spinner .rect5 {animation-delay:-.8s}
    @keyframes sk-stretchdelay {
        0%,40%,100% {transform:scaleY(0.4);}
        20% {transform:scaleY(1.0);}
    }

    #market_name_search { float: right; background: rgba(0, 0, 0, 0.25); color: white; border: none;height: 25px; padding-left: 6px;}
    .price_option_price { width: 100px }
    .inventory_item_price { top: 0px;position: absolute;right: 0;background: #3571a5;padding: 2px;color: white; font-size:11px; border: 1px solid #666666;}

    .see_inventory_buttons {display:flex;flex-wrap:wrap;gap:10px;align-items:start;}
    .see_inventory_buttons > .see_inventory_buttons, .see_inventory_buttons > #inventory_items_spinner {flex-basis: 100%;}
    #see_market_progress { display: block; width: 50%; height: 20px; }
    #see_market_progress[hidden] { visibility: hidden; }
    .item_market_action_button.see_button_busy { pointer-events: none; opacity: 0.6; cursor: default; }

    #see_settings { background: #26566c; margin-right: 10px; height: 24px; line-height:24px; display:inline-block; padding: 0px 6px; }
    #see_settings_modal select, #see_settings_modal input[type="number"] { background-color: black; color: white; border: transparent; padding: 4px 8px; }
    #see_settings_modal input[type="number"] { width: 100px; }
    #see_settings_modal input[type="checkbox"] { width: 16px; height: 16px; vertical-align: middle; accent-color: #000; }

    #see_page_jump { margin-left: 15px; display: inline-block; }
    #see_page_jump > input { width: 60px; margin-right: 8px; background-color: #1b2838; color: #fff; border: 1px solid #4582a5; padding: 2px 5px; }
`);

$(document).ready(() => {
    // Make sure the user is logged in, there's not much we can do otherwise.
    if (!isLoggedIn) {
        return;
    }

    if (currentPage == PAGE_INVENTORY) {
        initializeInventoryUI();
    }

    if (currentPage == PAGE_MARKET || currentPage == PAGE_MARKET_LISTING) {
        initializeMarketUI();
    }

    if (currentPage == PAGE_TRADEOFFER) {
        initializeTradeOfferUI();
    }
});

function injectCss(css) {
    const head = document.getElementsByTagName('head')[0];
    if (!head) {
        return;
    }
    const style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = css;
    head.appendChild(style);
}

function renderSpinner(text) {
    const { container, spinnerid } = getSpinnerContext();
    if (container == null || spinnerid == null) {
        return;
    }

    text = (text || '').trim();
    removeSpinner();

    container.append(`
        <div id="${spinnerid}">
            <div class="spinner">
                <div class="rect1"></div>
                <div class="rect2"></div>
                <div class="rect3"></div>
                <div class="rect4"></div>
                <div class="rect5"></div>
            </div>
            ${text ? `<div style="text-align:center">${text}</div>` : ''}
        </div>`);
}

function removeSpinner() {
    const { container, spinnerid } = getSpinnerContext();
    if (container == null || spinnerid == null) {
        return;
    }

    $(`#${spinnerid}`, container).remove();
}

function getSpinnerContext() {
    let container = null;
    let spinnerid = null;

    switch (currentPage) {
        case PAGE_MARKET:
            container = $('.my_market_header').eq(0);
            spinnerid = 'market_listings_spinner';
            break;
        case PAGE_INVENTORY:
            container = $('#inventory_sell_buttons');
            spinnerid = 'inventory_items_spinner';
            break;
        default:
            break;
    }

    container = container && container.length > 0 ? container : null;
    return { container, spinnerid };
}

$.fn.delayedEach = function (timeout, callback, continuous) {
    const $els = this;
    const iterator = function (index) {
        if (index >= $els.length) {
            if (!continuous) {
                return;
            }
            index = 0;
        }

        const cur = $els[index];
        callback.call(cur, index, cur);

        setTimeout(() => {
            iterator(++index);
        }, timeout);
    };

    iterator(0);
};
//#endregion

//#region Exports
// The shape request() attaches to the Error it hands callers. Exported as a type so tests
// can assert on .statusCode/.responseText without casting the contract away.
export type { RequestError };

// Real ES exports replacing the old `typeof module !== 'undefined'` test seam. Same names,
// same contract: anything listed here must be callable without a page, a network or a
// logged-in Steam session.

export const requestPolicy = {
    REQUEST_BREAKER_STATUSES,
    REQUEST_BREAKER_THRESHOLD,
    REQUEST_BREAKER_WINDOW_MS,
    REQUEST_DELAY_DEFAULT,
    REQUEST_DELAY_ERROR,
    REQUEST_DELAY_MARKET,
};

export {
    CalculateAmountToSendForDesiredReceivedAmount,
    CalculateFeeAmount,
    aggregateTradeOfferAssets,
    buildOrderBook,
    calculateAverageHistoryPriceBeforeFees,
    calculateBuyOrderPriceBeforeFees,
    calculateListingPriceBeforeFees,
    calculateSellPriceBeforeFees,
    clamp,
    createFailureCounter,
    createListingState,
    createPricingRules,
    createSteamPage,
    flattenItem,
    getAssetKey,
    getIsCrate,
    getListingVerdict,
    getIsFoilTradingCard,
    getIsTradingCard,
    getMarketHashName,
    getNumberOfDigits,
    getRequestDelay,
    getRequestStoppedMessage,
    isItemQueued,
    markItemQueued,
    readInventoryItems,
    request,
    stopRequests,
    isRetryMessage,
    markRow,
    NO_LISTING_PRICE_SENTINEL,
    nextQueueStep,
    nextRetryDelay,
    padLeftZero,
    pickSellListingsHeader,
    priceBeforeFees,
    priceIncludingFees,
    replaceNonNumbers,
    resetRetryDelay,
    runQueue,
};

export { ROW_STATUS_COLORS } from './constants.ts';
//#endregion
