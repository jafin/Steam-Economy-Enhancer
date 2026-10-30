// A spinner on a market row while one of the queues is working on it.
//
// The pricing pass, relisting and removal all take seconds per listing, and the only sign a
// row was being worked on was its background changing colour once the work was over. This is
// the sign while it is happening.
//
// It sits between the price cell and the Remove cell. Steam floats both of those right, so the
// one that comes first in the markup is the rightmost: Remove, then this, then the price. That
// puts it after the price column and before Remove without taking room from either.

import $ from 'jquery';

// The same bars the page-level spinner uses (see renderSpinner in src/ui/index.ts), so the two
// read as one thing; main.ts shrinks them with .see_spinner_small.
export const SPINNER_BARS = `
    <div class="rect1"></div>
    <div class="rect2"></div>
    <div class="rect3"></div>
    <div class="rect4"></div>
    <div class="rect5"></div>`;

/** Show the spinner on a listing row. Safe to call twice; a row never carries two. */
export function showRowSpinner(listingUI): void {
    const row = $(listingUI);

    if ($('.see_row_spinner', row).length > 0) {
        return;
    }

    // A row with no price cell is not one this script prices, and there is nowhere to anchor.
    const priceCell = $('.market_listing_my_price', row).last();

    if (priceCell.length == 0) {
        return;
    }

    priceCell.before(
        `<div class="see_row_spinner" title="Updating..."><div class="spinner see_spinner_small">${SPINNER_BARS}</div></div>`,
    );
}

/** Take the spinner off a listing row. Safe when there is none. */
export function hideRowSpinner(listingUI): void {
    $('.see_row_spinner', $(listingUI)).remove();
}
