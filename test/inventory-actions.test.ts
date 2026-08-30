// The label/action pipeline disagreement TASK-03 exists to fix.
//
// Nine functions repeat render-spinner -> loadAllInventories -> getInventoryItems -> filter by
// a capability -> skip queued items -> markItemQueued -> push to a queue -> totals.queued ->
// re-render the spinner. The label path (the *_selected getters in src/inventory/selection.ts)
// and the action path (turnSelectedItemsIntoGems in src/inventory/gems.ts, and the boosters
// pair) drifted: the action path skips items a queue already has, the label path does not, so
// a button can read "Turn 5 Items Into Gems" and queue three.
//
// This pins the disagreement with real counts rather than a code inspection, so the refactor
// that removes it is provably a fix rather than a guess.

import { test } from 'vitest';
import assert from 'node:assert';
import { markItemQueued } from '../src/items/index.ts';
import { hasOwnerAction, selectedItemsWhere } from '../src/inventory/actions.ts';
import { turnSelectedItemsIntoGems } from '../src/inventory/gems.ts';
import { endRun, runTotals } from '../src/totals.ts';

test('hasOwnerAction is false when the item has no owner_actions at all', () => {
    assert.strictEqual(hasOwnerAction({}, 'GetGooValue'), false);
});

test('hasOwnerAction is false when every action has a null link', () => {
    const item = { owner_actions: [{ link: null }, { link: null }] };

    assert.strictEqual(hasOwnerAction(item, 'GetGooValue'), false);
});

test('hasOwnerAction is true when one action link contains the fragment', () => {
    const item = {
        owner_actions: [{ link: null }, { link: 'https://.../ajaxgetgoovalue/?GetGooValue' }],
    };

    assert.strictEqual(hasOwnerAction(item, 'GetGooValue'), true);
});

test('hasOwnerAction is false when a link is present but does not match the fragment', () => {
    const item = { owner_actions: [{ link: 'https://.../ajaxunpackbooster/?OpenBooster' }] };

    assert.strictEqual(hasOwnerAction(item, 'GetGooValue'), false);
});

// A gem-able asset: an owner_actions entry whose link contains 'GetGooValue', same as Steam's
// real inventory data and what selection.ts/gems.ts both probe for.
function gemmableAsset() {
    return {
        appid: 730,
        contextid: 2,
        marketable: 1,
        owner_actions: [
            { link: 'https://steamcommunity.com/id/test/ajaxgetgoovalue/?GetGooValue' },
        ],
        description: {},
    };
}

function setInventoryAssets(assets: Record<string, unknown>) {
    (globalThis as any).unsafeWindow.g_ActiveInventory.m_rgAssets = assets;
    (globalThis as any).unsafeWindow.g_ActiveInventory.m_rgChildInventories = {};
}

// Marks every asset id as selected in the DOM -- both getSelectedItems() (selection.ts) and
// turnSelectedItemsIntoGems() read the selection back this way, through steamPage.
function selectInInventory(assetIds: string[]) {
    const holders = assetIds
        .map(
            (id) =>
                `<div class="itemHolder ui-selected"><div id="730_2_${id}" class="item"></div></div>`,
        )
        .join('');

    document.body.innerHTML = `
        <div id="inventories">
            <div class="inventory_ctn"><div class="inventory_page">${holders}</div></div>
        </div>`;
}

// Waits out the loadAllInventories().then(...) microtask chain both functions under test run
// on. A real macrotask, not a fake timer -- nothing in this suite mocks the clock.
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

test('the gems button label counts an item the actual enqueue skips because it is already queued', async () => {
    endRun();

    setInventoryAssets({ 501: gemmableAsset(), 502: gemmableAsset() });
    selectInInventory(['501', '502']);

    // One of the two selected items is already on a queue from an earlier action.
    markItemQueued({ appid: 730, contextid: 2, id: '501' });

    const labelItems = await selectedItemsWhere((item) => hasOwnerAction(item, 'GetGooValue'));
    const labelCount = labelItems.length;

    assert.strictEqual(labelCount, 2, 'sanity check: both selected items are gem-able');

    turnSelectedItemsIntoGems();
    await flush();

    assert.strictEqual(
        runTotals().queuedItems,
        labelCount,
        'the button label and the number of items the action actually enqueues must agree',
    );
});
