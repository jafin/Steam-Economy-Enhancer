// The market page's own furniture: the buttons this script adds above the listings table.

import { VERDICT_OVERPRICED } from '../constants.ts';
import { openSettings } from '../settings/dialog.ts';
import { SETTING_RELIST_AUTOMATICALLY, setSetting } from '../settings/index.ts';
import { steamPage } from '../steam/instance.ts';
import { replaceNonNumbers } from '../util/numbers.ts';
import { initializeMarketHistoryUI } from './history.ts';
import { processMarketListings } from './listings.ts';
import { increaseMarketProgressMax, setProgressBar } from './progress.ts';
import { queueOverpricedItemListing } from './relist.ts';
import { marketRemoveQueue } from './remove.ts';
import { getListingFromLists } from './rows.ts';
import { marketSectionFor, selectionFor, tableHeaderSectionFor } from './selection.ts';
import { sortMarketListings } from './sort.ts';
import $ from 'jquery';
// Update the select/deselect all button on the market.
export function updateMarketSelectAllButton() {
    $('.market_listing_buttons').each(function () {
        const group = marketSectionFor(this);
        let invert =
            $('.market_select_item:checked', group).length ==
            $('.market_select_item', group).length;
        if ($('.market_select_item', group).length == 0) {
            // If there are no items to select, keep it at Select all.
            invert = false;
        }
        $('.select_all > span', group).text(invert ? 'Deselect all' : 'Select all');
    });
}

// Initialize the market UI.
export function initializeMarketUI() {
    $('.market_header_text').append('<progress id="see_market_progress" value="1" max="1" hidden>');
    setProgressBar(document.getElementById('see_market_progress') as HTMLProgressElement);

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

        const section = tableHeaderSectionFor(this);

        const isPrice =
            $('.market_listing_table_header', section).children().eq(1).text() == $(this).text();
        const isDate =
            $('.market_listing_table_header', section).children().eq(2).text() == $(this).text();
        const isName =
            $('.market_listing_table_header', section).children().eq(3).text() == $(this).text();

        sortMarketListings(section, isPrice, isDate, isName);
    });

    $('.select_all').on('click', '*', function () {
        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows, group } = selection;
        const invert =
            $('.market_select_item:checked', group).length ==
            $('.market_select_item', group).length;

        for (let i = 0; i < rows.length; i++) {
            $('.market_select_item', rows[i].elm).prop('checked', !invert);
        }

        updateMarketSelectAllButton();
    });

    $('.select_five_from_page').on('click', '*', function () {
        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows } = selection;
        let count = 0;
        for (let i = 0; i < rows.length; i++) {
            if (count == 5) {
                break;
            }
            if (!$('.market_select_item', rows[i].elm).prop('checked')) {
                $('.market_select_item', rows[i].elm).prop('checked', true);
                count += 1;
            }
        }

        updateMarketSelectAllButton();
    });

    $('.select_twentyfive_from_page').on('click', '*', function () {
        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows } = selection;
        let count = 0;
        for (let i = 0; i < rows.length; i++) {
            if (count == 25) {
                break;
            }
            if (!$('.market_select_item', rows[i].elm).prop('checked')) {
                $('.market_select_item', rows[i].elm).prop('checked', true);
                count += 1;
            }
        }

        updateMarketSelectAllButton();
    });

    $('.select_overpriced').on('click', '*', function () {
        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows, group } = selection;
        for (let i = 0; i < rows.length; i++) {
            if ($(rows[i].elm).hasClass(VERDICT_OVERPRICED)) {
                $('.market_select_item', rows[i].elm).prop('checked', true);
            }
        }

        $('.market_listing_row', group).each(function () {
            if ($(this).hasClass(VERDICT_OVERPRICED)) {
                $('.market_select_item', $(this)).prop('checked', true);
            }
        });

        updateMarketSelectAllButton();
    });

    $('.remove_selected').on('click', '*', function () {
        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows } = selection;
        for (let i = 0; i < rows.length; i++) {
            if ($('.market_select_item', $(rows[i].elm)).prop('checked')) {
                const listingid = replaceNonNumbers(rows[i].values().market_listing_item_name);

                const listing = getListingFromLists(listingid);
                if (listing == null) {
                    continue;
                }

                const listingUI = $(listing.elm);
                listingUI.addClass('removing');

                marketRemoveQueue.push({ listingid });
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

        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows } = selection;
        for (let i = 0; i < rows.length; i++) {
            if ($(rows[i].elm).hasClass(VERDICT_OVERPRICED)) {
                const listingid = replaceNonNumbers(rows[i].values().market_listing_item_name);
                queueOverpricedItemListing(listingid);
            }
        }
    });

    $('.relist_selected').on('click', '*', function () {
        const selection = selectionFor(this);

        if (selection == null) {
            return;
        }

        const { rows } = selection;
        for (let i = 0; i < rows.length; i++) {
            if ($(rows[i].elm) && $('.market_select_item', $(rows[i].elm)).prop('checked')) {
                const listingid = replaceNonNumbers(rows[i].values().market_listing_item_name);
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
