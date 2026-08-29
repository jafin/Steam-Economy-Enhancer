// Finding the item behind a listing.
//
// A market row knows its listing id; the asset it refers to lives in Steam's own
// g_rgAssets, reached through the page adapter.

import { steamPage } from '../steam/instance.ts';
import { replaceNonNumbers } from '../util/numbers.ts';
import { getListingFromLists } from './sort.ts';
import $ from 'jquery';

// Match number part from any currency format
export const getPriceValueAsInt = (listing) =>
    steamPage.parsePriceText(listing.match(/(?<price>[0-9][0-9 .,]*)/)?.groups?.price ?? 0);

// Gets the asset info (appid/contextid/assetid) based on a listingid.
export function getAssetInfoFromListingId(listingid) {
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

export function getAssetInfoFromBuyOrderId(orderid) {
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
