// The spinner a market row carries while a queue is working on it, and the small one beside
// the progress bar. Placement is the part worth pinning: Steam floats the cells right, so
// document order is the reverse of what the user sees.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import { hideRowSpinner, showRowSpinner } from '../src/market/rowSpinner.ts';
import { addWork, setProgressBar, setProgressSpinner, workDone } from '../src/market/progress.ts';

function row(): JQuery {
    document.body.innerHTML = `
        <div class="market_listing_row">
            <div class="market_listing_edit_buttons actual_content"></div>
            <div class="market_listing_my_price"></div>
        </div>`;

    return $('.market_listing_row');
}

beforeEach(() => {
    document.body.innerHTML = '';
});

test('the spinner goes between the Remove cell and the price cell', () => {
    const listingUI = row();

    showRowSpinner(listingUI);

    const order = listingUI
        .children()
        .toArray()
        .map((el) => el.className.split(' ')[0]);

    assert.deepStrictEqual(order, [
        'market_listing_edit_buttons',
        'see_row_spinner',
        'market_listing_my_price',
    ]);
});

test('showing it twice leaves one, and hiding it takes it away', () => {
    const listingUI = row();

    showRowSpinner(listingUI);
    showRowSpinner(listingUI);

    assert.strictEqual($('.see_row_spinner', listingUI).length, 1);

    hideRowSpinner(listingUI);
    hideRowSpinner(listingUI);

    assert.strictEqual($('.see_row_spinner', listingUI).length, 0);
});

test('a row with no price cell is left alone', () => {
    document.body.innerHTML = '<div class="market_listing_row"></div>';

    assert.doesNotThrow(() => showRowSpinner($('.market_listing_row')));
    assert.strictEqual($('.see_row_spinner').length, 0);
});

test('the progress spinner is shown exactly while the progress bar is', () => {
    document.body.innerHTML = '<progress id="bar"></progress><div id="spin" hidden></div>';
    setProgressBar(document.getElementById('bar') as HTMLProgressElement);
    setProgressSpinner(document.getElementById('spin') as HTMLElement);

    // Start from a finished run so this does not depend on what ran before it.
    addWork(1);
    workDone();

    assert.strictEqual($('#spin').attr('hidden') !== undefined, true, 'hidden with nothing queued');

    addWork(2);

    assert.strictEqual($('#spin').attr('hidden'), undefined, 'shown while work is outstanding');

    workDone(2);

    assert.strictEqual($('#spin').attr('hidden') !== undefined, true, 'hidden again once done');
});
