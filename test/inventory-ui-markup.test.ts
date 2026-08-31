// updateInventoryUI against Steam markup that is missing pieces it used to assume.
//
// The buttons this script adds are appended near the end of updateInventoryUI, so anything
// that throws earlier takes the entire inventory UI with it -- and silently, since nothing
// catches it. `$('#inventory_logos')[0].style.height` was one such read: a cosmetic height
// tweak, indexed blind, ahead of every button.

import { beforeEach, test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import '../src/vendor/jquery-observe.js';
import { updateInventorySelection, updateInventoryUI } from '../src/inventory/ui.ts';

// The inventory page reduced to what updateInventoryUI reaches for: the nav it prepends the
// reload button to, the app logo it inserts the logger after, and the settings menu. Whether
// #inventory_logos is present is the variable under test.
function buildInventoryPage({ withLogos }: { withLogos: boolean }) {
    document.body.innerHTML = `
        <div id="global_action_menu"></div>
        <div id="inventories">
            <div class="inventory_ctn"><div class="inventory_page"></div></div>
        </div>
        ${withLogos ? '<div id="inventory_logos"></div>' : ''}
        <div id="inventory_applogo"></div>
        <div class="inventory_rightnav"></div>`;
}

beforeEach(() => {
    document.body.innerHTML = '';
});

test('the inventory buttons are added when #inventory_logos is present', () => {
    buildInventoryPage({ withLogos: true });

    updateInventoryUI(true);

    assert.strictEqual($('#inventory_sell_buttons').length, 1);
    assert.strictEqual($('#inventory_reload_button').length, 1);
    assert.strictEqual($('#inventory_logos')[0]?.style.height, 'auto');
});

// The regression this guard exists for: without #inventory_logos the function threw on the
// blind index, and every button below it was never appended.
test('the inventory buttons are still added when #inventory_logos is absent', () => {
    buildInventoryPage({ withLogos: false });

    assert.doesNotThrow(() => updateInventoryUI(true));

    assert.strictEqual($('#inventory_sell_buttons').length, 1);
    assert.strictEqual($('#inventory_reload_button').length, 1);
});

// updateInventorySelection reads the selected item's name twice: once to decide whether it
// is a booster pack, and once when logging an order-book failure. The first read used to be
// a bare `selectedItem.name`, which throws for an item carrying its name only on its
// description -- the exact shape the second read already allowed for. The panel then never
// rendered, with nothing in the log to say why.
test('a selected item named only on its description does not throw', async () => {
    document.body.innerHTML = `<div id="iteminfo0"><h1>Item</h1><div><span>Community</span></div></div>`;
    (globalThis as any).unsafeWindow.iActiveSelectView = 0;

    const descriptionOnly = {
        appid: 753,
        contextid: '6',
        id: '1',
        // No top-level `name`, and `marketable` absent so the function returns straight after
        // the booster-pack check -- which is the read under test.
        description: { name: 'Sackboy Booster Pack', market_hash_name: 'Sackboy Booster Pack' },
    };

    await assert.doesNotReject(async () => {
        await updateInventorySelection(descriptionOnly);
    });
});

test('an item carrying no name at all does not throw', async () => {
    document.body.innerHTML = `<div id="iteminfo0"><h1>Item</h1><div><span>Community</span></div></div>`;
    (globalThis as any).unsafeWindow.iActiveSelectView = 0;

    await assert.doesNotReject(async () => {
        await updateInventorySelection({
            appid: 753,
            contextid: '6',
            id: '1',
            description: { market_hash_name: 'Some Item' },
        });
    });
});
