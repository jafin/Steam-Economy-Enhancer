// The live page context.
//
// One adapter over Steam's globals, built once at load, plus the three facts every part of
// the script asks about the page it is running on: which page it is, whether anyone is
// logged in, and where the inventory JSON lives.

import { createSteamPage } from './page.ts';
import { PAGE_INVENTORY, PAGE_MARKET, PAGE_MARKET_LISTING, PAGE_TRADEOFFER } from '../constants.ts';

export const steamPage = createSteamPage(unsafeWindow);

export const country = steamPage.countryCode();

export const isLoggedIn = steamPage.isLoggedIn();

export const currentPage = window.location.href.includes('.com/market')
    ? window.location.href.includes('market/listings')
        ? PAGE_MARKET_LISTING
        : PAGE_MARKET
    : window.location.href.includes('.com/tradeoffer')
      ? PAGE_TRADEOFFER
      : PAGE_INVENTORY;

export function getInventoryUrl() {
    const inventoryLoadUrl = steamPage.inventoryLoadUrl();
    if (inventoryLoadUrl) {
        return inventoryLoadUrl;
    }

    let profileUrl = `${window.location.origin}/my/`;

    const steamProfileUrl = steamPage.profileUrl();
    if (steamProfileUrl) {
        profileUrl = steamProfileUrl;
    } else {
        const avatar = document.querySelector<HTMLAnchorElement>('#global_actions a.user_avatar');

        if (avatar) {
            profileUrl = avatar.href;
        }
    }

    return `${profileUrl.replace(/\/$/, '')}/inventory/json/`;
}
