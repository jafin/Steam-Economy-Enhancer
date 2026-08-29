// The Steam Market API.
//
// One object wrapping the market endpoints this script uses: listing an item, removing a
// listing, price history, order books, and turning items into gems or unpacking booster
// packs. Responses that are worth caching go through the session store.
//
// Still an old-style constructor function with prototype methods, as it always was.
// Converting it to a class would be a change of shape rather than of location, so it is
// left for its own commit.
//
// Every method reports the same way, so a caller learns one thing rather than three:
//
//   callback(errorCode, data)            the methods that change something
//   callback(errorCode, value, cached)   price history and order books
//
// errorCode is ERROR_SUCCESS on success, ERROR_FAILED when the request itself failed, and
// ERROR_DATA when Steam answered normally and said no. The later arguments are always
// passed -- because a caller cannot state what it receives if half the methods stop short --
// and carry whatever the method actually has: null when the request failed and there is no
// response, Steam's own body on a refusal where it holds the message worth showing.
// sellItem used to hand request()'s own callback straight to the caller, which is why its
// failures arrived as an Error while everything else's arrived as a sentinel, and why two
// callers of that one method read it two different ways.
//
// ERROR_DATA is only ever produced where Steam is known to report refusals; see
// docs/adr/0002-steam-success-is-checked-on-sellitem-only.md for which methods those are
// and why the rest deliberately do not check.

import { ERROR_DATA, ERROR_FAILED, ERROR_SUCCESS } from '../constants.ts';
import { getMarketHashName } from '../items/index.ts';
import { request } from '../net/request.ts';
import { readCookie } from '../util/cookie.ts';
import { priceBeforeFees, priceIncludingFees } from '../pricing/fees.ts';
import { getSetting, SETTING_PRICE_ALGORITHM } from '../settings/index.ts';
import { storageSession } from '../storage/session.ts';
import { useRound } from './currency.ts';
import { getInventoryUrl, isLoggedIn, steamPage } from './instance.ts';

export function SteamMarket(this: any, appContext, inventoryUrl, walletInfo) {
    this.appContext = appContext;
    this.inventoryUrl = inventoryUrl;
    this.walletInfo = walletInfo;
    this.inventoryUrlBase = inventoryUrl.replace('/inventory/json', '');
    if (!this.inventoryUrlBase.endsWith('/')) {
        this.inventoryUrlBase += '/';
    }
}

// Whether Steam answered normally and then declined to do the thing.
//
// Different from the request failing. The response arrived, so we know the action did not
// happen and a retry is safe -- where a transport failure leaves the outcome unknown and a
// retry can list the same item twice.
//
// Truthiness rather than `success === false`, matching what inventory/sell.ts has read off
// this response for years: a body with no success field, or success: 0, counts as refused.
// Only called where Steam is known to answer this way; see
// docs/adr/0002-steam-success-is-checked-on-sellitem-only.md for which endpoints those are
// and why the others are deliberately not checked.
function steamRefused(data) {
    return !data?.success;
}

export function buildOrderBook(data) {
    if (!data || steamRefused(data) || !data.data) {
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

// Sell an item with a price in cents.
// Price is before fees.

// The one SteamMarket instance for the page.
//
// It lives beside the constructor rather than in the entry file because several prototype
// methods call through this singleton rather than through `this` -- getPriceHistory defers
// to market.getCurrentPriceHistory, for example. Putting the instance anywhere else would
// make the class and its own instance import each other.
export const market = new SteamMarket(
    steamPage.appContextData(),
    getInventoryUrl(),
    isLoggedIn ? steamPage.walletInfo() : undefined,
);

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

    // Reported the same way as every other method here, rather than by handing request()'s
    // own callback to the caller. Forwarding it made this the one method whose failures
    // arrived as an Error rather than a sentinel, which is why two callers of the same
    // method read its result two different ways.
    request(url, options, (error, data) => {
        if (error) {
            callback(ERROR_FAILED, null);
            return;
        }

        // A rejected listing comes back as a 200 with success:false, so the request
        // succeeding is not the same as the item being listed. Asking here rather than
        // leaving it to callers is the whole point: market/relist.ts asked only whether
        // there was an error, and so treated a rejection as a completed relist -- painting
        // the row green and then removing the listing, with the item sitting unlisted in
        // the user's inventory. The body is passed on because it carries the message the
        // caller shows and classifies.
        if (steamRefused(data)) {
            callback(ERROR_DATA, data);
            return;
        }

        callback(ERROR_SUCCESS, data);
    });
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
            callback(ERROR_FAILED, null);
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
        getSetting(SETTING_PRICE_ALGORITHM) == 1 || getSetting(SETTING_PRICE_ALGORITHM) == 4;

    if (!shouldUseAverage) {
        // The price history is only used by the "average price" calculation
        return callback(ERROR_SUCCESS, null, true);
    }

    try {
        const market_name = getMarketHashName(item);
        if (market_name == null) {
            callback(ERROR_FAILED, null, false);
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
        return callback(ERROR_FAILED, null, false);
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
                callback(ERROR_FAILED, null);
                return;
            }

            callback(ERROR_SUCCESS, data);
        });
    } catch {
        return callback(ERROR_FAILED, null);
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
                callback(ERROR_FAILED, null);
                return;
            }

            callback(ERROR_SUCCESS, data);
        });
    } catch {
        return callback(ERROR_FAILED, null);
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
                callback(ERROR_FAILED, null);
                return;
            }

            callback(ERROR_SUCCESS, data);
        });
    } catch {
        return callback(ERROR_FAILED, null);
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
            callback(ERROR_FAILED, null, false);
            return;
        }

        if (data && (steamRefused(data) || !data.prices)) {
            callback(ERROR_DATA, null, false);
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

// Get the order book for this item in the market, with more information.
SteamMarket.prototype.getOrderBook = function (item, cache, callback) {
    try {
        const market_name = getMarketHashName(item);
        if (market_name == null) {
            callback(ERROR_FAILED, null, false);
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
        return callback(ERROR_FAILED, null, false);
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
            callback(ERROR_FAILED, null, false);
            return;
        }

        const orderbook = buildOrderBook(data?.data);
        if (orderbook == null) {
            callback(ERROR_DATA, null, false);
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
