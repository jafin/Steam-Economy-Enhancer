// The market page's own furniture: the buttons this script adds above the listings table.

import { VERDICT_OVERPRICED } from '../constants.ts';
import { openSettings } from '../settings/dialog.ts';
import { SETTING_RELIST_AUTOMATICALLY, setSetting } from '../settings/index.ts';
import { steamPage } from '../steam/instance.ts';
import { replaceNonNumbers } from '../util/numbers.ts';
import { initializeMarketHistoryUI } from './history.ts';
import { processMarketListings } from './listings.ts';
import { increaseMarketProgressMax, marketProgress } from './progress.ts';
import { queueOverpricedItemListing } from './relist.ts';
import { marketRemoveQueue } from './remove.ts';
import { getListFromContainer, getListingFromLists, sortMarketListings } from './sort.ts';
import $ from 'jquery';
// Update the select/deselect all button on the market.
export function updateMarketSelectAllButton() {
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

// Initialize the market UI.
export function initializeMarketUI() {
    $('.market_header_text').append('<progress id="see_market_progress" value="1" max="1" hidden>');
    marketProgress.bar = document.getElementById('see_market_progress');

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
