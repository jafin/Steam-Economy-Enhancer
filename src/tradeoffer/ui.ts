// The trade offer page.
//
// Both sides of an offer get the same summary, so the code loops over ['them', 'me'] rather
// than being written out twice. Items arrive as the user scrolls, so the summary is
// recalculated as they load.

import { getActiveInventory, setInventoryPrices } from '../inventory/data.ts';
import { getAssetKey, readInventoryItems } from '../items/index.ts';
import { listingState } from '../market/listingState.ts';
import { formatPrice } from '../pricing/algorithms.ts';
import { SETTING_TRADEOFFER_PRICE_LABELS, getSetting } from '../settings/index.ts';
import { steamPage } from '../steam/instance.ts';
import { aggregateTradeOfferAssets } from './totals.ts';
import $ from 'jquery';
//#region Tradeoffers
// --- Page-scoped code, hoisted to module scope (see the note above) ---
// Original guard: currentPage == PAGE_TRADEOFFER
// Gets the trade offer's inventory items from the active inventory.
export function getTradeOfferInventoryItems() {
    return readInventoryItems(getActiveInventory(), 'rgChildInventories', 'rgInventory');
}

// side is 'me' or 'them' - see steamPage.tradeAssets/findTradeAsset.
export function sumTradeOfferAssets(side) {
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

export let lastTradeOfferSum = 0;

// Both sides of a trade are walked the same way, by the same two steamPage calls, in
// four different places. TRADE_SIDES is that walk, done once each time instead of once
// per side per place.
export const TRADE_SIDES = ['them', 'me'];

export function tradeItemsFor(side) {
    return steamPage
        .tradeAssets(side)
        .map((asset) =>
            steamPage.findTradeAsset(side, asset.appid, asset.contextid, asset.assetid),
        );
}

export function hasLoadedAllTradeOfferItems() {
    return TRADE_SIDES.every((side) => tradeItemsFor(side).every((asset) => asset != null));
}

export function initializeTradeOfferUI() {
    if (getSetting(SETTING_TRADEOFFER_PRICE_LABELS) == 1) {
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
