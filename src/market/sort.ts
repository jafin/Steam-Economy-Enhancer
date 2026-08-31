// Sorting and searching the market listings.
//
// Backed by list.js, which is the only place in the script that uses it. Keeping that one
// dependency behind one module means replacing it later is a single-file question.

import { logConsole } from '../ui/logger.ts';
import { getPriceValueAsInt } from './assets.ts';
import { replaceNonNumbers } from '../util/numbers.ts';
import { getListFromContainer } from './rows.ts';
import $ from 'jquery';
import * as luxon from 'luxon';

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

    let market_listing_selector: JQuery<HTMLElement> | undefined;
    if (isPrice) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(1);
    } else if (isDateOrQuantity) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(2);
    } else if (isName) {
        market_listing_selector = $('.market_listing_table_header', elem).children().eq(3);
    }

    // There was no else, so all three false meant `undefined.text()` and a throw. That is
    // reachable: market/ui.ts binds the sort with a delegated .on('click', 'span'), so a
    // click on a span nested inside a header span fires the handler a second time with the
    // inner span as `this`, tableHeaderSectionFor's two-hop walk lands on the header rather
    // than the section, children() finds nothing, and all three flags come back false.
    //
    // Return rather than defaulting to a column. A click that resolves to no column is a
    // click this script has nothing to say about, and silently sorting by price would be
    // worse than doing nothing. The arrows have already been stripped by the .each() above,
    // so the table is left with no arrow at all -- which is honest: the sort did not happen.
    if (market_listing_selector == null || market_listing_selector.length === 0) {
        logConsole('No sortable column matched the clicked header, ignoring.');
        return;
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

        // Steam renders a listing's date as 'd MMM' with no year, so a month later than the
        // current one must belong to last year. Pulled out of the comparator so the parse and
        // the rollback happen once per operand rather than being written twice inline.
        const listedDate = (row): luxon.DateTime => {
            const parsed = luxon.DateTime.fromFormat(
                row.values().market_listing_listed_date.trim(),
                'd MMM',
            );

            if (parsed.isValid && parsed.month > currentMonth) {
                return parsed.plus({ years: -1 });
            }

            return parsed;
        };

        if (isBuyOrder) {
            list.sort('market_listing_buyorder_qty', {
                order: asc ? 'asc' : 'desc',
                sortFunction: function (a, b) {
                    // Parsed rather than subtracted as strings. `'12' - '5'` coerces and
                    // happens to work; `'1,234' - '5'` is NaN, and a NaN comparator makes the
                    // whole sort implementation-defined. replaceNonNumbers is the house idiom
                    // for exactly this.
                    const quantityA = parseInt(
                        replaceNonNumbers(
                            a.elm.querySelector('.market_listing_buyorder_qty').innerText,
                        ),
                        10,
                    );
                    const quantityB = parseInt(
                        replaceNonNumbers(
                            b.elm.querySelector('.market_listing_buyorder_qty').innerText,
                        ),
                        10,
                    );

                    if (isNaN(quantityA) || isNaN(quantityB)) {
                        return 0;
                    }

                    return quantityA - quantityB;
                },
            });
        } else {
            list.sort('market_listing_listed_date', {
                order: asc ? 'asc' : 'desc',
                sortFunction: function (a, b) {
                    const first = listedDate(a);
                    const second = listedDate(b);

                    // `if (firstDate == null)` never fired: DateTime.fromFormat returns an
                    // *invalid* DateTime on a parse failure, never null, so an unparseable
                    // date used to propagate as NaN through the comparison instead. isValid
                    // is the check that was meant.
                    if (!first.isValid || !second.isValid) {
                        return 0;
                    }

                    // Subtraction rather than three comparisons. The old form tested
                    // `firstDate === secondDate`, which compares DateTime *references* and is
                    // therefore never true -- so two equal dates returned -1 in both
                    // directions, and Array.prototype.sort with an inconsistent comparator has
                    // implementation-defined output: two listings from the same day could come
                    // out in any order.
                    return first.valueOf() - second.valueOf();
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
