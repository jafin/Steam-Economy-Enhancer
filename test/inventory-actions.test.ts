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
import $ from 'jquery';
import { markItemQueued } from '../src/items/index.ts';
import { hasOwnerAction, withInventory } from '../src/inventory/actions.ts';
import { logger } from '../src/ui/logger.ts';
import { turnSelectedItemsIntoGems } from '../src/inventory/gems.ts';
import { updateButtons } from '../src/inventory/ui.ts';
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
// turnSelectedItemsIntoGems() read the selection back this way, through steamPage. The
// turn_into_gems button markup is the same shape updateInventoryUI builds it as (see ui.ts),
// cut down to what updateTurnIntoGemsButton actually reads and writes.
function buildInventoryPage(assetIds: string[]) {
    const holders = assetIds
        .map(
            (id) =>
                `<div class="itemHolder ui-selected"><div id="730_2_${id}" class="item"></div></div>`,
        )
        .join('');

    document.body.innerHTML = `
        <div id="inventories">
            <div class="inventory_ctn"><div class="inventory_page">${holders}</div></div>
        </div>
        <a class="turn_into_gems" style="display:none"><span></span></a>`;
}

// Waits out the loadAllInventories().then(...) microtask chain both functions under test run
// on. A real macrotask, not a fake timer -- nothing in this suite mocks the clock.
function flush() {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

// The count the "Turn N Items Into Gems" button currently displays.
function turnIntoGemsButtonCount(): number {
    const match = $('.turn_into_gems > span')
        .text()
        .match(/^Turn (\d+)/);

    return match ? Number(match[1]) : 0;
}

test('the gems button label and the actual enqueue count agree, even when an item is already queued', async () => {
    endRun();

    setInventoryAssets({ 501: gemmableAsset(), 502: gemmableAsset() });
    buildInventoryPage(['501', '502']);

    // One of the two selected items is already on a queue from an earlier action.
    markItemQueued({ appid: 730, contextid: 2, id: '501' });

    updateButtons();
    await flush();

    const labelCount = turnIntoGemsButtonCount();
    assert.strictEqual(labelCount, 1, 'the already-queued item must not be counted');

    turnSelectedItemsIntoGems();
    await flush();

    assert.strictEqual(
        runTotals().queuedItems,
        labelCount,
        'the button label and the number of items the action actually enqueues must agree',
    );
});

// --- withInventory: both ends of the spinner closed ---------------------------------------
//
// Every inventory action is load-then-act, and all eight of them called removeSpinner only
// on the success path. A refused or hanging inventory load therefore left the user watching
// a spinner that never stopped, an unhandled rejection in the console, and nothing on the
// page -- the failure mode net/request.ts's breaker exists to avoid.
//
// The spinner container depends on which page this is; under test that is the market page,
// so `.my_market_header` is what getSpinnerContext() resolves to.
function buildSpinnerHost() {
    document.body.innerHTML = '<div class="my_market_header"></div>';
}

function spinnerCount(): number {
    return $('#market_listings_spinner').length;
}

// loadAllInventories() is `async`, so a synchronous throw inside it surfaces as a rejection.
function makeInventoryLoadFail() {
    (globalThis as any).unsafeWindow.g_ActiveInventory.LoadCompleteInventory = () => {
        throw new Error('Steam said no');
    };
}

function restoreInventoryLoad() {
    (globalThis as any).unsafeWindow.g_ActiveInventory.LoadCompleteInventory = () => ({
        done: (callback: () => void) => callback(),
    });
}

test('withInventory runs the action and takes the spinner down on success', async () => {
    buildSpinnerHost();
    restoreInventoryLoad();
    logger.innerHTML = '';

    let ran = 0;
    withInventory(() => ran++);

    assert.strictEqual(spinnerCount(), 1, 'the spinner is up while the inventory loads');

    await flush();

    assert.strictEqual(ran, 1);
    assert.strictEqual(spinnerCount(), 0, 'and down again afterwards');
    assert.strictEqual(logger.textContent, '', 'nothing is logged on the happy path');
});

test('withInventory takes the spinner down and says so when the load is refused', async () => {
    buildSpinnerHost();
    makeInventoryLoadFail();
    logger.innerHTML = '';

    let ran = 0;
    withInventory(() => ran++);

    assert.strictEqual(spinnerCount(), 1);

    await flush();

    assert.strictEqual(ran, 0, 'the action must not run against an inventory that never loaded');
    assert.strictEqual(spinnerCount(), 0, 'the spinner comes down on the failure path too');
    assert.match(logger.textContent ?? '', /Could not load the inventory/);

    restoreInventoryLoad();
});

// Note there is deliberately no test for an action that throws. The rejection handler is
// .then's second argument rather than a trailing .catch, so it sees load failures only and an
// error thrown by the action escapes as it always has -- asserting on that would mean
// planting an unhandled rejection in the suite to observe it. The point of the two-argument
// form is that such an error is never misreported to the user as a failed inventory load.

// hasOwnerAction walks owner_actions with for...of now, matching steam/market.ts, where it
// used for...in -- which walks inherited enumerable properties and yields string keys.
test('hasOwnerAction is unaffected by properties added to Array.prototype', () => {
    // for...in would have visited this and thrown reading `.link` off a string key.
    (Array.prototype as any).aStrayGlobal = 'from some other script';

    try {
        const item = { owner_actions: [{ link: 'https://.../ajaxgetgoovalue/?GetGooValue' }] };

        assert.strictEqual(hasOwnerAction(item, 'GetGooValue'), true);
        assert.strictEqual(hasOwnerAction({ owner_actions: [] }, 'GetGooValue'), false);
    } finally {
        delete (Array.prototype as any).aStrayGlobal;
    }
});

test('hasOwnerAction tolerates a null entry in owner_actions', () => {
    assert.strictEqual(hasOwnerAction({ owner_actions: [null] } as any, 'GetGooValue'), false);
});
