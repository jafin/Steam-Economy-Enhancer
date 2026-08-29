// The inventory's click, Ctrl-click and Shift-click selection.
//
// Two things are being guarded. First, the contract between the halves of the feature: the
// handlers in src/inventory/ui.ts are the only thing that puts 'ui-selected' on an item, and
// getSelectedItems() in src/inventory/selection.ts is the only thing that reads it back. If
// they stop agreeing, nothing throws -- the sell buttons quietly act on an empty selection.
//
// Second, the modifier behaviour itself, which is jQuery UI `selectable`'s and which people
// have muscle memory for. It survived one library swap already; these tests are what make the
// next change to it deliberate rather than accidental.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import { initializeInventorySelection } from '../src/inventory/ui.ts';
import { getSelectedItems } from '../src/inventory/selection.ts';

// Steam's inventory markup, cut down to the parts both modules look for: getSelectedItems()
// walks .inventory_ctn -> .inventory_page -> .itemHolder -> .item, and reads the asset id off
// the trailing number in the .item element's id.
function buildInventory() {
    const holders = ['111', '222', '333', '444']
        .map((id) => `<div class="itemHolder"><div id="730_2_${id}" class="item"></div></div>`)
        .join('');

    document.body.innerHTML = `
        <div id="inventories">
            <div class="inventory_ctn"><div class="inventory_page">${holders}</div></div>
        </div>`;
}

function holderFor(assetId: string) {
    return $(`#730_2_${assetId}`).closest('.itemHolder');
}

function click(assetId: string, modifiers: { shiftKey?: boolean; ctrlKey?: boolean } = {}) {
    holderFor(assetId).trigger($.Event('click', modifiers));
}

beforeEach(() => {
    buildInventory();
    initializeInventorySelection();
});

test('a plain click selects one item', () => {
    click('222');

    assert.deepStrictEqual(getSelectedItems(), ['222']);
});

test('a plain click clears whatever was selected before', () => {
    click('111');
    click('333');

    assert.deepStrictEqual(getSelectedItems(), ['333']);
});

test('Ctrl-click adds to the selection without clearing it', () => {
    click('111');
    click('333', { ctrlKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['111', '333']);
});

test('Ctrl-click toggles an already selected item back off', () => {
    click('111');
    click('333', { ctrlKey: true });
    click('111', { ctrlKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['333']);
});

test('Shift-click selects the range from the anchor, in either direction', () => {
    click('222');
    click('444', { shiftKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['222', '333', '444']);

    click('333');
    click('111', { shiftKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['111', '222', '333']);
});

test('the anchor persists, so a second Shift-click re-extends from it', () => {
    // The one deliberate change from the original hand-rolled version, which reset the anchor
    // after every use and so made the second Shift-click do nothing useful.
    click('111');
    click('444', { shiftKey: true });
    click('222', { shiftKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['111', '222']);
});

test('Shift-click with no anchor behaves like a plain click', () => {
    click('333', { shiftKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['333']);
});

test('items Steam has hidden while searching are skipped', () => {
    // Steam sets display:none on filtered-out items. A range drawn across one must not pick it
    // up, and it must not count as a step in the range either.
    holderFor('222').attr('style', 'display: none;');

    click('111');
    click('333', { shiftKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['111', '333']);
    assert.strictEqual(holderFor('222').hasClass('ui-selected'), false);
});

test('items Steam renders after setup are selectable', () => {
    // The inventory is re-rendered when you page through it or switch game, so the handler is
    // delegated and re-resolves the items on every click. Binding to the elements up front
    // would strand everything Steam draws after this point -- silently, since nothing throws.
    $('.inventory_page').append(
        '<div class="itemHolder"><div id="730_2_555" class="item"></div></div>',
    );

    click('444');
    click('555', { shiftKey: true });

    assert.deepStrictEqual(getSelectedItems(), ['444', '555']);
});

test('mousedown is cancelled, so dragging does not drag the item icons', () => {
    // jQuery UI's mouse widget did this. Without it the browser drags the <img> item icons as
    // ghost images and Shift-click extends a text selection instead of a range.
    const event = $.Event('mousedown');
    holderFor('111').trigger(event);

    assert.strictEqual(event.isDefaultPrevented(), true);
});
