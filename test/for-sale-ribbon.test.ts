import { test, beforeEach } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import { markRow, markRowForSale } from '../src/ui/index.ts';

// The ribbon an inventory tile gets once its listing succeeds. Unlike markRow, which writes
// an inline style the test harness cannot read back off a fake, this appends a real element
// to a real tile -- happy-dom and jQuery are both real here -- so the DOM is what gets
// asserted rather than the arguments.
//
// Steam's inventory tile, cut down to the part this touches: the element carrying the
// `appid_contextid_assetid` id is the .item inside an .itemHolder.
function buildTile(style = '') {
    document.body.innerHTML = `
        <div class="itemHolder">
            <div id="730_2_111" class="item" style="${style}">
                <img src="data:," alt="">
            </div>
        </div>`;
}

const tile = () => $('#730_2_111');

beforeEach(() => {
    buildTile();
});

test('a successful listing puts one ribbon on the tile', () => {
    markRowForSale('730_2_111');

    assert.strictEqual(tile().find('.see_for_sale').length, 1);
});

test('the ribbon reads "For sale"', () => {
    markRowForSale('730_2_111');

    assert.strictEqual(tile().find('.see_for_sale b').text(), 'For sale');
});

test('the ribbon is appended, not put in place of the item icon', () => {
    markRowForSale('730_2_111');

    assert.strictEqual(tile().find('img').length, 1, 'Steam draws the icon; we draw beside it');
});

test('listing the same item twice does not stack two ribbons', () => {
    markRowForSale('730_2_111');
    markRowForSale('730_2_111');

    assert.strictEqual(tile().find('.see_for_sale').length, 1);
});

test('the tile is made a positioning context, or the ribbon lands somewhere else entirely', () => {
    markRowForSale('730_2_111');

    assert.strictEqual(tile().css('position'), 'relative');
});

test('a position Steam set itself is left alone', () => {
    // Overriding it would move whatever Steam positions against the tile, and nothing would
    // throw when it did.
    buildTile('position: absolute;');

    markRowForSale('730_2_111');

    assert.strictEqual(tile().css('position'), 'absolute');
});

test('an asset key with no tile on the page does not throw', () => {
    // Inventory pages render one page of items at a time; a queue can outlive the tile it
    // started with.
    assert.doesNotThrow(() => markRowForSale('730_2_999'));
});

test('marking a row successful does not by itself add a ribbon', () => {
    // gems.ts and boosters.ts mark success on these same tiles. An item turned into gems or
    // unpacked is not for sale, so the ribbon has to come from the sell queue asking for it.
    markRow('730_2_111', 'success');

    assert.strictEqual(tile().find('.see_for_sale').length, 0);
});
