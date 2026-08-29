// The settings dialog.
//
// Built as an HTML string and shown through Steam's own modal, so it looks like part of the
// page rather than something bolted on. Every field is keyed by the setting name, which is
// what lets this be a loop over settingDefaults rather than a form written out by hand.

import $ from 'jquery';
import { steamPage } from '../steam/instance.ts';
import {
    SETTING_INVENTORY_PRICE_LABELS,
    SETTING_MAX_FOIL_PRICE,
    SETTING_MAX_MISC_PRICE,
    SETTING_MAX_NORMAL_PRICE,
    SETTING_MIN_FOIL_PRICE,
    SETTING_MIN_MISC_PRICE,
    SETTING_MIN_NORMAL_PRICE,
    SETTING_PRICE_ALGORITHM,
    SETTING_PRICE_HISTORY_HOURS,
    SETTING_PRICE_IGNORE_LOWEST_Q,
    SETTING_PRICE_MIN_CHECK_PRICE,
    SETTING_PRICE_MIN_LIST_PRICE,
    SETTING_PRICE_OFFSET,
    SETTING_QUICK_SELL_BUTTONS,
    SETTING_RELIST_AUTOMATICALLY,
    SETTING_TRADEOFFER_PRICE_LABELS,
    getSetting,
    setSetting,
} from './index.ts';
//#region Settings
export function openSettings() {
    const price_options = $(`<div id="see_settings_modal">
        <div>
            Calculate prices as the:&nbsp;
            <select id="${SETTING_PRICE_ALGORITHM}">
                <option value="1"${getSetting(SETTING_PRICE_ALGORITHM) == 1 ? 'selected="selected"' : ''}>Maximum of the average history and lowest sell listing</option>
                <option value="2" ${getSetting(SETTING_PRICE_ALGORITHM) == 2 ? 'selected="selected"' : ''}>Lowest sell listing</option>
                <option value="3" ${getSetting(SETTING_PRICE_ALGORITHM) == 3 ? 'selected="selected"' : ''}>Highest current buy order or lowest sell listing</option>
                <option value="4" ${getSetting(SETTING_PRICE_ALGORITHM) == 4 ? 'selected="selected"' : ''}>Average history only</option>
            </select>
        </div>
        <div style="margin-top:6px;">
            Hours to use for the average history calculated price:&nbsp;
            <input type="number" min="0" step="2" id="${SETTING_PRICE_HISTORY_HOURS}" value=${getSetting(SETTING_PRICE_HISTORY_HOURS)}>
        </div>
        <div style="margin-top:6px;">
            The value to add to the calculated price (minimum and maximum are respected):&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_OFFSET}" value=${getSetting(SETTING_PRICE_OFFSET)}>
        </div>
        <div style="margin-top:6px">
            Use the second lowest sell listing when the lowest sell listing has a low quantity:&nbsp;
            <input type="checkbox" id="${SETTING_PRICE_IGNORE_LOWEST_Q}" ${getSetting(SETTING_PRICE_IGNORE_LOWEST_Q) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px;">
            Don't check market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_CHECK_PRICE}" value=${getSetting(SETTING_PRICE_MIN_CHECK_PRICE)}>
        </div>
        <div style="margin-top:6px;">
            Don't list market listings with prices of and below:&nbsp;
            <input type="number" step="0.01" id="${SETTING_PRICE_MIN_LIST_PRICE}" value=${getSetting(SETTING_PRICE_MIN_LIST_PRICE)}>
        </div>
        <div style="margin-top:24px">
            Show price labels in inventory:&nbsp;
            <input type="checkbox" id="${SETTING_INVENTORY_PRICE_LABELS}" ${getSetting(SETTING_INVENTORY_PRICE_LABELS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px">
            Show price labels in trade offers:&nbsp;
            <input type="checkbox" id="${SETTING_TRADEOFFER_PRICE_LABELS}" ${getSetting(SETTING_TRADEOFFER_PRICE_LABELS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:6px">
            Show quick sell info and buttons:&nbsp;
            <input type="checkbox" id="${SETTING_QUICK_SELL_BUTTONS}" ${getSetting(SETTING_QUICK_SELL_BUTTONS) == 1 ? 'checked' : ''}>
        </div>
        <div style="margin-top:24px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_NORMAL_PRICE}" value=${getSetting(SETTING_MIN_NORMAL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_NORMAL_PRICE}" value=${getSetting(SETTING_MAX_NORMAL_PRICE)}>
            &nbsp;price for normal cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_FOIL_PRICE}" value=${getSetting(SETTING_MIN_FOIL_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_FOIL_PRICE}" value=${getSetting(SETTING_MAX_FOIL_PRICE)}>
            &nbsp;price for foil cards
        </div>
        <div style="margin-top:6px;">
            Minimum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MIN_MISC_PRICE}" value=${getSetting(SETTING_MIN_MISC_PRICE)}>
            &nbsp;and maximum:&nbsp;
            <input type="number" step="0.01" id="${SETTING_MAX_MISC_PRICE}" value=${getSetting(SETTING_MAX_MISC_PRICE)}>
            &nbsp;price for other items
        </div>
        <div style="margin-top:6px;">
            Automatically relist overpriced market listings (slow on large inventories):&nbsp;
            <input id="${SETTING_RELIST_AUTOMATICALLY}" class="market_relist_auto" type="checkbox" ${getSetting(SETTING_RELIST_AUTOMATICALLY) == 1 ? 'checked' : ''}>
        </div>
    </div>`);

    steamPage.showConfirmDialog('Steam Economy Enhancer', price_options).done(() => {
        // Every one of these returns false when the browser refused the write -- private
        // mode, disabled site data, quota. All fourteen run regardless, so one refusal
        // does not leave the rest of the form half-saved; but if any did, reloading would
        // throw away the settings the user just entered in favour of whatever is on disk.
        const allSettingsSaved = [
            setSetting(
                SETTING_MIN_NORMAL_PRICE,
                $(`#${SETTING_MIN_NORMAL_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_MAX_NORMAL_PRICE,
                $(`#${SETTING_MAX_NORMAL_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_MIN_FOIL_PRICE,
                $(`#${SETTING_MIN_FOIL_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_MAX_FOIL_PRICE,
                $(`#${SETTING_MAX_FOIL_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_MIN_MISC_PRICE,
                $(`#${SETTING_MIN_MISC_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_MAX_MISC_PRICE,
                $(`#${SETTING_MAX_MISC_PRICE}`, price_options).val(),
            ),
            setSetting(SETTING_PRICE_OFFSET, $(`#${SETTING_PRICE_OFFSET}`, price_options).val()),
            setSetting(
                SETTING_PRICE_MIN_CHECK_PRICE,
                $(`#${SETTING_PRICE_MIN_CHECK_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_PRICE_MIN_LIST_PRICE,
                $(`#${SETTING_PRICE_MIN_LIST_PRICE}`, price_options).val(),
            ),
            setSetting(
                SETTING_PRICE_ALGORITHM,
                $(`#${SETTING_PRICE_ALGORITHM}`, price_options).val(),
            ),
            setSetting(
                SETTING_PRICE_IGNORE_LOWEST_Q,
                $(`#${SETTING_PRICE_IGNORE_LOWEST_Q}`, price_options).prop('checked') ? 1 : 0,
            ),
            setSetting(
                SETTING_PRICE_HISTORY_HOURS,
                $(`#${SETTING_PRICE_HISTORY_HOURS}`, price_options).val(),
            ),
            setSetting(
                SETTING_RELIST_AUTOMATICALLY,
                $(`#${SETTING_RELIST_AUTOMATICALLY}`, price_options).prop('checked') ? 1 : 0,
            ),
            setSetting(
                SETTING_INVENTORY_PRICE_LABELS,
                $(`#${SETTING_INVENTORY_PRICE_LABELS}`, price_options).prop('checked') ? 1 : 0,
            ),
            setSetting(
                SETTING_TRADEOFFER_PRICE_LABELS,
                $(`#${SETTING_TRADEOFFER_PRICE_LABELS}`, price_options).prop('checked') ? 1 : 0,
            ),
            setSetting(
                SETTING_QUICK_SELL_BUTTONS,
                $(`#${SETTING_QUICK_SELL_BUTTONS}`, price_options).prop('checked') ? 1 : 0,
            ),
        ].every(Boolean);

        if (!allSettingsSaved) {
            window.alert(
                'Steam Economy Enhancer could not save your settings -- the browser refused the write. Check that this site is allowed to store data (private browsing and disabled site data both block it), then try again.',
            );
            return;
        }

        window.location.reload();
    });
}
