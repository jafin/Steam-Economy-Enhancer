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
import {
    initializeInventoryUI,
    updateInventorySelection,
    updateInventoryUI,
} from '../src/inventory/ui.ts';
import { logger } from '../src/ui/logger.ts';

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

// --- registrations that are page-lifetime, not per-tab ------------------------------------
//
// updateInventoryUI re-runs on every .games_list_tabs click. It removes the button
// containers it created first, so their handlers go with them, but two registrations used to
// survive and stack: the #logger scroll handler and the #pagecontrol_cur observer. Measured
// in a live browser on 31 Aug 2026 -- 1 of each at page load, 5 of each after four tab
// switches, on the same #pagecontrol_cur node throughout.
//
// These assertions read the same two places that measurement read: jQuery's event store for
// the scroll handler, and jquery-observe's `patterns` array (kept as jQuery data under
// 'observer') for the observer. Counting registrations rather than invocations is what makes
// the growth visible -- jquery-observe keeps one MutationObserver per element and runs every
// pattern on it, so N patterns means N handler calls per mutation.
//
// Written as one scenario rather than several, deliberately: "register once" is page-lifetime
// state that outlives a single test, so a second test asserting the initial registration
// would be reading the flag the first one already set. This is also why it is the only test
// in this file that puts a #pagecontrol_cur on the page.

function scrollHandlerCount(element: Element): number {
    return (($ as any)._data(element, 'events')?.scroll ?? []).length;
}

function observePatternCount(selector: string): number {
    return ($(selector).data('observer')?.patterns ?? []).length;
}

// loadAllInventories().then(...) is where the observer is registered.
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

test('neither the logger scroll handler nor the prices observer stacks across tab switches', async () => {
    buildInventoryPage({ withLogos: true });
    $('body').append('<div class="games_list_tabs"></div><div id="pagecontrol_cur"></div>');

    initializeInventoryUI();
    await flush();

    assert.strictEqual(scrollHandlerCount(logger), 1, 'one scroll handler at page load');
    assert.strictEqual(observePatternCount('#pagecontrol_cur'), 1, 'one observer at page load');

    // Four rebuilds, as four game-tab clicks produce. This is where the growth was: 5 and 5.
    for (let i = 0; i < 4; i++) {
        updateInventoryUI(true);
    }
    await flush();

    assert.strictEqual(
        scrollHandlerCount(logger),
        1,
        'still one scroll handler after four tab switches',
    );
    assert.strictEqual(
        observePatternCount('#pagecontrol_cur'),
        1,
        'still one observer pattern after four tab switches',
    );

    // The scroll binding is on the `logger` node, which updateInventoryUI re-inserts after
    // #inventory_applogo on every rebuild. jQuery handlers move with a node rather than being
    // lost, which is what makes one binding enough.
    assert.notStrictEqual(logger.parentElement, null, 'the logger is still attached');
});
