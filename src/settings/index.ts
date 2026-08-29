// The user's settings.
//
// Keys are their own names, which is what lets the settings dialog build itself from this
// list. Reads go through getSettingWithDefault so a key that has never been written still
// answers with something sensible rather than null.

import { getLocalStorageItem, setLocalStorageItem } from '../storage/index.ts';

//#region Settings
export const SETTING_MIN_NORMAL_PRICE = 'SETTING_MIN_NORMAL_PRICE';

export const SETTING_MAX_NORMAL_PRICE = 'SETTING_MAX_NORMAL_PRICE';

export const SETTING_MIN_FOIL_PRICE = 'SETTING_MIN_FOIL_PRICE';

export const SETTING_MAX_FOIL_PRICE = 'SETTING_MAX_FOIL_PRICE';

export const SETTING_MIN_MISC_PRICE = 'SETTING_MIN_MISC_PRICE';

export const SETTING_MAX_MISC_PRICE = 'SETTING_MAX_MISC_PRICE';

export const SETTING_PRICE_OFFSET = 'SETTING_PRICE_OFFSET';

export const SETTING_PRICE_MIN_CHECK_PRICE = 'SETTING_PRICE_MIN_CHECK_PRICE';

export const SETTING_PRICE_MIN_LIST_PRICE = 'SETTING_PRICE_MIN_LIST_PRICE';

export const SETTING_PRICE_ALGORITHM = 'SETTING_PRICE_ALGORITHM';

export const SETTING_PRICE_IGNORE_LOWEST_Q = 'SETTING_PRICE_IGNORE_LOWEST_Q';

export const SETTING_PRICE_HISTORY_HOURS = 'SETTING_PRICE_HISTORY_HOURS';

export const SETTING_INVENTORY_PRICE_LABELS = 'SETTING_INVENTORY_PRICE_LABELS';

export const SETTING_TRADEOFFER_PRICE_LABELS = 'SETTING_TRADEOFFER_PRICE_LABELS';

export const SETTING_QUICK_SELL_BUTTONS = 'SETTING_QUICK_SELL_BUTTONS';

export const SETTING_LAST_CACHE = 'SETTING_LAST_CACHE';

export const SETTING_RELIST_AUTOMATICALLY = 'SETTING_RELIST_AUTOMATICALLY';

export const settingDefaults = {
    SETTING_MIN_NORMAL_PRICE: 0.05,
    SETTING_MAX_NORMAL_PRICE: 2.5,
    SETTING_MIN_FOIL_PRICE: 0.15,
    SETTING_MAX_FOIL_PRICE: 10,
    SETTING_MIN_MISC_PRICE: 0.05,
    SETTING_MAX_MISC_PRICE: 10,
    SETTING_PRICE_OFFSET: 0.0,
    SETTING_PRICE_MIN_CHECK_PRICE: 0.0,
    SETTING_PRICE_MIN_LIST_PRICE: 0.03,
    SETTING_PRICE_ALGORITHM: 1,
    SETTING_PRICE_IGNORE_LOWEST_Q: 1,
    SETTING_PRICE_HISTORY_HOURS: 12,
    SETTING_INVENTORY_PRICE_LABELS: 1,
    SETTING_TRADEOFFER_PRICE_LABELS: 1,
    SETTING_QUICK_SELL_BUTTONS: 1,
    SETTING_LAST_CACHE: 0,
    SETTING_RELIST_AUTOMATICALLY: 0,
};

export function getSettingWithDefault(name) {
    return getLocalStorageItem(name) || (name in settingDefaults ? settingDefaults[name] : null);
}

export function setSetting(name, value) {
    setLocalStorageItem(name, value);
}
