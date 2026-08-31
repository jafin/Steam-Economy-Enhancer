// getAssetInfoFromBuyOrderId reading a buy order's price out of the row.
//
// The price used to be read as `$('.market_listing_price', elm)[0].innerText` -- an
// unguarded index into a jQuery selection, so a row Steam renders without that element
// threw instead of returning. Same class as the other `!` assertions on Steam's markup.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import { getAssetInfoFromBuyOrderId } from '../src/market/assets.ts';
import { marketLists } from '../src/market/rows.ts';

// The registry lookup getAssetInfoFromBuyOrderId goes through. A list.js List exposes
// get(valueName, value) returning matching items; this stands in for one holding a single
// row, which is all these assertions need.
function registerBuyOrderRow(orderId: string, innerHtml: string) {
    const elm = document.createElement('div');
    elm.id = `mbuyorder_${orderId}`;
    elm.innerHTML = innerHtml;
    document.body.appendChild(elm);

    marketLists.push({
        get: (valueName: string, value: string) =>
            valueName === 'market_listing_item_name' && value === `mbuyorder_${orderId}_name`
                ? [{ elm }]
                : [],
    });
}

beforeEach(() => {
    marketLists.length = 0;
    document.body.innerHTML = '';
});

test('a buy order row reports its quantity and price', () => {
    registerBuyOrderRow(
        '77',
        `<span class="market_listing_buyorder_qty"> 12 </span>
         <span class="market_listing_price">0,80€</span>`,
    );

    assert.deepStrictEqual(getAssetInfoFromBuyOrderId('77'), { amount: 12, price: 80 });
});

test('a buy order row with no price element returns rather than throwing', () => {
    registerBuyOrderRow('77', '<span class="market_listing_buyorder_qty"> 12 </span>');

    let result: any;
    assert.doesNotThrow(() => {
        result = getAssetInfoFromBuyOrderId('77');
    });

    // getPriceValueAsInt's `?? 0` fallback handles the empty string.
    assert.strictEqual(result.amount, 12);
    assert.strictEqual(result.price, 0);
});

// The price element carries nested spans on a real row, so the read has to survive the
// whitespace textContent brings that innerText did not.
test('a price nested in spans is still parsed', () => {
    registerBuyOrderRow(
        '77',
        `<span class="market_listing_buyorder_qty">3</span>
         <span class="market_listing_price">
             <span>
                 <span>1,00€</span>
             </span>
         </span>`,
    );

    assert.strictEqual(getAssetInfoFromBuyOrderId('77').price, 100);
});
