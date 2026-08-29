// Progress across a run.
//
// A run can have several queues working at once -- selling, gems, boosters -- so the totals
// and the spinner belong to the run rather than to any one queue. onQueueDrain is what every
// queue calls when it empties, and only the last one out resets anything.

import $ from 'jquery';
import { formatPrice } from '../pricing/algorithms.ts';
import { totals } from '../totals.ts';
import { removeSpinner } from '../ui/index.ts';
import { logger } from '../ui/logger.ts';
import { boosterQueue } from './boosters.ts';
import { scrapQueue } from './gems.ts';
import { itemQueue, sellQueue } from './sell.ts';
export function onQueueDrain() {
    if (
        itemQueue.length() == 0 &&
        sellQueue.length() == 0 &&
        scrapQueue.length() == 0 &&
        boosterQueue.length() == 0
    ) {
        removeSpinner();
    }
}

export function updateTotals() {
    if ($('#loggerTotal').length == 0) {
        $(logger).parent().append('<div id="loggerTotal"></div>');
    }

    // Named for the element it holds. `totals` is now the imported run totals object, and
    // the two were previously the same identifier in this function.
    //
    // Asserted non-null because the block above has just created it if it was missing. That
    // guard is the reason this has never thrown; the assertion states it rather than adding
    // a second check that could never fire.
    const totalsElement = document.getElementById('loggerTotal')!;
    totalsElement.innerHTML = '';

    if (totals.priceWithFeesOnMarket > 0) {
        totalsElement.innerHTML += `<div><strong>Total listed for ${formatPrice(totals.priceWithFeesOnMarket)}, you will receive ${formatPrice(totals.priceWithoutFeesOnMarket)}.</strong></div>`;
    }
    if (totals.scrap > 0) {
        totalsElement.innerHTML += `<div><strong>Total scrap ${totals.scrap}.</strong></div>`;
    }
}

export function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
