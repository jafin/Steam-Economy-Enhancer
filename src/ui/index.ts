// Small pieces of page furniture the script adds.
//
// A stylesheet injected once, a spinner that knows which container to attach itself to on
// each page, and the row colouring the queues use to report progress.

import $ from 'jquery';

import { PAGE_INVENTORY, PAGE_MARKET, ROW_STATUS_COLORS } from '../constants.ts';
import { currentPage } from '../steam/instance.ts';

// Colours an inventory row by asset key - the same `appid_contextid_assetid` id every
// inventory item element carries (see getAssetKey, below). Replaces nine identical
// `$('#'+appid+'_'+contextid+'_'+itemId).css('background', COLOR_X)` sites that only
// ever differed in which COLOR_* they painted.
export function markRow(assetKey, status) {
    $(`#${assetKey}`).css('background', ROW_STATUS_COLORS[status]);
}

export function injectCss(css) {
    const head = document.getElementsByTagName('head')[0];
    if (!head) {
        return;
    }
    const style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = css;
    head.appendChild(style);
}

export function renderSpinner(text) {
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

export function removeSpinner() {
    const { container, spinnerid } = getSpinnerContext();
    if (container == null || spinnerid == null) {
        return;
    }

    $(`#${spinnerid}`, container).remove();
}

export function getSpinnerContext() {
    // Typed rather than inferred from the initialiser: `null` on its own would infer `null`
    // and reject the assignments in the switch below.
    let container: JQuery<HTMLElement> | null = null;
    let spinnerid: string | null = null;

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
