// The inventory page's own furniture.
//
// The buttons this script adds above the inventory, the price labels and quick-sell buttons
// on each item, and the selection behaviour that lets Shift and Ctrl pick several at once.

import $ from 'jquery';
import { openSettings } from '../settings/dialog.ts';
import { flattenItem, getMarketHashName, isItemQueued } from '../items/index.ts';
import { formatPrice } from '../pricing/algorithms.ts';
import {
    SETTING_INVENTORY_PRICE_LABELS,
    SETTING_QUICK_SELL_BUTTONS,
    getSetting,
} from '../settings/index.ts';
import { steamPage } from '../steam/instance.ts';
import { market } from '../steam/market.ts';
import { queued } from '../totals.ts';
import { logConsole, logger, setUserScrolled } from '../ui/logger.ts';
import { unpackAllBoosterPacks, unpackSelectedBoosterPacks } from './boosters.ts';
import {
    getActiveInventory,
    getInventoryItems,
    loadAllInventories,
    setInventoryPrices,
} from './data.ts';
import { gemAllDuplicateItems, turnSelectedItemsIntoGems } from './gems.ts';
import { delay } from './progress.ts';
import {
    getInventorySelectedBoosterPackItems,
    getInventorySelectedGemsItems,
    getInventorySelectedMarketableItems,
    selectAllCards,
} from './selection.ts';
import {
    canSellSelectedItemsManually,
    sellAllCards,
    sellAllCrates,
    sellAllDuplicateItems,
    sellAllItems,
    sellQueue,
    sellSelectedItems,
    sellSelectedItemsManually,
} from './sell.ts';
// Initialize the inventory UI.
export function initializeInventoryUI() {
    const isOwnInventory = steamPage.activeUser().strSteamId == steamPage.steamId();
    updateInventoryUI(isOwnInventory);

    $('.games_list_tabs').on('click', '*', () => {
        updateInventoryUI(isOwnInventory);
    });

    // Ignore selection on other user's inventories.
    if (!isOwnInventory) {
        return;
    }

    initializeInventorySelection();

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

// Click, Ctrl-click and Shift-click selection over the inventory grid.
//
// This was jQuery UI's `selectable` widget -- the only jQuery UI method the script ever
// called, for which the whole 250KB library was @require'd. It was briefly @viselect/vanilla
// instead, which is 18KB rather than 250KB but brought two problems with it on this page: its
// listeners sit on `document` and competed with Steam's own, and unlike jQuery UI it does not
// cancel the default mousedown, so dragging across the grid started a native image-drag of the
// item icons and highlighted text.
//
// Both were the price of the rubber-band lasso, which nothing here needs -- and once the lasso
// goes, so does the reason to have a selection library at all. What is left is the code below.
// Note that the lasso was invisible for years anyway: jQuery UI's script was @require'd but
// never its stylesheet, so nobody could see the band they were dragging.
//
// Behaviour, which is jQuery UI's and therefore what people already have muscle memory for:
//
//   - plain click clears the selection and selects one item;
//   - Ctrl (or Cmd) click toggles one item and leaves the rest alone;
//   - Shift click clears, then selects the range from the anchor to the clicked item. The
//     anchor persists, so a second Shift-click re-extends from it rather than resetting --
//     the one deliberate change, agreed when the widget was replaced, and what every file
//     manager does.
//
// Exported so the tests can wire it to their own markup; only initializeInventoryUI calls it.
export function initializeInventorySelection() {
    // Steam adds 'display:none' to items while searching. These should not be selected while
    // using shift/ctrl.
    const filter = `.itemHolder${steamPage.visibleItemHolderSelector()}`;
    const inventories = $('#inventories');

    // Where a Shift-click measures its range from: the last item picked without Shift. Held as
    // the element rather than an index because Steam re-renders the inventory pages when you
    // page through them or switch game, which would silently invalidate an index. If the
    // anchor is gone from the grid by the time it is used, the Shift-click falls back to
    // behaving like a plain one.
    let anchor: HTMLElement | null = null;

    // What jQuery UI's mouse widget did on mousedown, and the reason it is back: without it the
    // browser's own defaults take over a drag across the grid -- item icons are <img>, so they
    // get dragged as ghost images, and Shift-click extends a text selection across the page
    // instead of a range of items.
    inventories.on('mousedown', filter, (event) => {
        event.preventDefault();
    });

    inventories.on('click', filter, function (this: HTMLElement, event) {
        // Resolved per click rather than once, because Steam re-renders these as you page
        // through the inventory and hides them as you type in the search box. jQuery UI's
        // `refresh` option did the same thing on every mousedown.
        const items = inventories.find(filter).toArray();
        const anchored = anchor !== null && items.includes(anchor);

        // classList rather than jQuery, and deliberately: jQuery 4 does not wrap a plain array
        // of elements correctly here -- $([a, b]) yields a three-entry collection with an
        // undefined in the middle, and removeClass on it silently does nothing. It fails quiet,
        // so do not "tidy" these loops back into $(items).removeClass(...).
        const select = (element: HTMLElement) => element.classList.add('ui-selected');
        const clear = () => items.forEach((item) => item.classList.remove('ui-selected'));

        if (event.shiftKey && anchored) {
            const from = items.indexOf(anchor!);
            const to = items.indexOf(this);

            clear();
            items.slice(Math.min(from, to), 1 + Math.max(from, to)).forEach(select);
        } else if (event.ctrlKey || event.metaKey) {
            this.classList.toggle('ui-selected');
            anchor = this;
        } else {
            clear();
            select(this);
            anchor = this;
        }

        updateButtons();
    });
}

// Updates the (selected) sell ... items button.
export function updateSellSelectedButton() {
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
export function updateTurnIntoGemsButton() {
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
export function updateOpenBoosterPacksButton() {
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

export function updateButtons() {
    updateSellSelectedButton();
    updateTurnIntoGemsButton();
    updateOpenBoosterPacksButton();
}

export async function updateInventorySelection(selectedItem) {
    if (getSetting(SETTING_QUICK_SELL_BUTTONS) != 1) {
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
            let price = $(this).attr('id')!.replace('quick_sell', '');
            price = market.getPriceBeforeFees(price);

            queued(1);

            sellQueue.push({
                item: selectedItem,
                sellPrice: price,
            });
        });

        $('.quick_sell_custom').on('click', () => {
            let price = Number($('#quick_sell_input', ownerActions).val()) * 100;
            price = market.getPriceBeforeFees(price);

            queued(1);

            sellQueue.push({
                item: selectedItem,
                sellPrice: price,
            });
        });
    });
}

// Update the inventory UI.
export function updateInventoryUI(isOwnInventory) {
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
            <a class="btn_darkblue_white_innerfade btn_medium_wide select_all_cards"><span>Select All Cards</span></a>
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
        setUserScrolled(!hasUserScrolledToBottom);
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
        $('.select_all_cards').on('click', '*', () => {
            selectAllCards();
            updateButtons();
        });
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
            if (getSetting(SETTING_INVENTORY_PRICE_LABELS) == 1) {
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
