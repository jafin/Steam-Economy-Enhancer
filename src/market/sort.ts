// Sorting and searching the market listings.
//
// Backed by list.js, which is the only place in the script that uses it. Keeping that one
// dependency behind one module means replacing it later is a single-file question.

import { logConsole } from '../ui/logger.ts';
import { getPriceValueAsInt } from './assets.ts';
import {
    getListFromContainer,
    getListingFromLists,
    marketLists,
    removeListingFromLists,
} from './rows.ts';
import $ from 'jquery';
import * as luxon from 'luxon';

// Re-exported so the rest of src/market/ can keep importing the row registry from here for
// one more commit, until every importer points at rows.ts directly.
export { getListFromContainer, getListingFromLists, marketLists, removeListingFromLists };

// Sort the market listings.
export function sortMarketListings(elem, isPrice, isDateOrQuantity, isName) {
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
