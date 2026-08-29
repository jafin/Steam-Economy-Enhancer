// The market row registry's missing-row contract.
//
// A listing can be absent from marketLists that a caller expects it in -- removed by an
// earlier pass, or not yet added while the page is still loading. Both lookups fall off
// the end of their loop and hand back `undefined` in that case, which is fine on its own,
// but two call sites used to dereference the result immediately instead of checking for
// it first: marketRemoveQueueWorker read `getListingFromLists(listingid).elm`, and the
// market page's "Remove selected" button did the same. Either one threw the moment a
// listing already gone from the registry was queued for removal again.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import List from 'list.js';
import {
    getListFromContainer,
    getListingFromLists,
    marketLists,
    removeListingFromLists,
} from '../src/market/rows.ts';
import { marketRemoveQueueWorker } from '../src/market/remove.ts';

// Matches the shape addMarketListings() (src/market/listings.ts) builds: a container with
// one row whose listing id lives in the 'market_listing_item_name' id attribute.
function registerList(containerId: string, listingId: string) {
    document.body.innerHTML = `
        <div id="${containerId}">
            <div class="list">
                <div class="market_listing_row">
                    <span class="market_listing_item_name" id="mylisting_${listingId}_name"></span>
                </div>
            </div>
        </div>`;

    const list = new List(containerId, {
        valueNames: [{ name: 'market_listing_item_name', attr: 'id' }],
    });
    marketLists.push(list);
    return list;
}

beforeEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = '';
});

test('getListingFromLists returns undefined when no list is registered at all', () => {
    assert.strictEqual(getListingFromLists('123456'), undefined);
});

test('getListingFromLists returns undefined for a listing id absent from a registered list', () => {
    registerList('market-a', '111');

    assert.strictEqual(getListingFromLists('999999'), undefined);
});

test('getListingFromLists finds a listing id present in a registered list', () => {
    registerList('market-a', '111');

    assert.notStrictEqual(getListingFromLists('111'), undefined);
});

test('getListFromContainer returns undefined for a container matching no registered list', () => {
    registerList('market-a', '111');

    const unrelatedGroup = [document.createElement('div')];
    assert.strictEqual(getListFromContainer(unrelatedGroup), undefined);
});

test('removeListingFromLists does not throw for a listing not in the registry', () => {
    registerList('market-a', '111');

    assert.doesNotThrow(() => removeListingFromLists('999999'));
});

// The defect this guards: before the fix, this threw a TypeError reading `.elm` off
// `undefined` instead of skipping the already-gone listing.
test('marketRemoveQueueWorker does not throw for a listing not in the registry', () => {
    let calledBack = false;
    let successArg: unknown;

    assert.doesNotThrow(() => {
        marketRemoveQueueWorker({ listingid: '999999' }, false, (success: unknown) => {
            calledBack = true;
            successArg = success;
        });
    });

    assert.strictEqual(calledBack, true);
    assert.strictEqual(successArg, true);
});
