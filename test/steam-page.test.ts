import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// createSteamPage(win) is the live adapter over Steam's own globals. These tests build it
// against a small fake `win` rather than unsafeWindow, so they exercise the same lookup and
// fallback logic a real page goes through without needing a browser.

test('isLoggedIn is true from a wallet, even with g_bLoggedIn absent', () => {
    const page = see.createSteamPage({ g_rgWalletInfo: { wallet_currency: 3 } });

    assert.strictEqual(page.isLoggedIn(), true);
});

test('isLoggedIn falls back to g_bLoggedIn when there is no wallet', () => {
    const page = see.createSteamPage({ g_bLoggedIn: true });

    assert.strictEqual(page.isLoggedIn(), true);
});

test('isLoggedIn is false when neither is set', () => {
    const page = see.createSteamPage({});

    assert.strictEqual(page.isLoggedIn(), false);
});

test('countryCode is undefined rather than throwing when Steam has not set it', () => {
    const page = see.createSteamPage({});

    assert.strictEqual(page.countryCode(), undefined);
});

test('assetFor answers null instead of throwing through a missing appid or contextid', () => {
    const page = see.createSteamPage({ g_rgAssets: {} });

    assert.strictEqual(page.assetFor('730', '2', '123'), undefined);
});

test('firstAsset finds the one asset g_rgAssets holds on a market listing page', () => {
    const asset = { id: '123', appid: 730 };
    const page = see.createSteamPage({
        g_rgAssets: {
            730: {
                2: {
                    123: asset,
                },
            },
        },
    });

    assert.strictEqual(page.firstAsset(), asset);
});

test('firstAsset answers null rather than throwing when g_rgAssets is empty', () => {
    const page = see.createSteamPage({ g_rgAssets: {} });

    assert.strictEqual(page.firstAsset(), null);
});

test('setAsset writes into g_rgAssets at the given path', () => {
    const asset = { id: '999' };
    const win = { g_rgAssets: { 730: { 2: {} } } };
    const page = see.createSteamPage(win);

    page.setAsset('730', '2', '999', asset);

    assert.strictEqual(win.g_rgAssets['730']['2']['999'], asset);
});

test("onInventorySelectItem calls Steam's own handler, then the given one, and can be undone", () => {
    const calls = [];
    const win = {
        CInventory: {
            prototype: {
                SelectItem(event, elItem, rgItem) {
                    calls.push(['original', rgItem]);
                },
            },
        },
    };
    const page = see.createSteamPage(win);
    const originalSelectItem = win.CInventory.prototype.SelectItem;

    const teardown = page.onInventorySelectItem((rgItem) => calls.push(['handler', rgItem]));

    assert.notStrictEqual(win.CInventory.prototype.SelectItem, originalSelectItem, 'patched');

    win.CInventory.prototype.SelectItem(null, null, 'item-1');

    assert.deepStrictEqual(calls, [
        ['original', 'item-1'],
        ['handler', 'item-1'],
    ]);

    teardown();

    assert.strictEqual(win.CInventory.prototype.SelectItem, originalSelectItem, 'restored');
});

test('onInventorySelectItem is a harmless no-op when CInventory never loaded', () => {
    const page = see.createSteamPage({});

    const teardown = page.onInventorySelectItem(() => {
        throw new Error('must not be called');
    });

    assert.doesNotThrow(teardown);
});

test('tradeAssets and findTradeAsset read the right side of the trade', () => {
    const meAssets = [{ appid: 1 }];
    const themAssets = [{ appid: 2 }];
    const foundByYou = { name: 'mine' };
    const foundByThem = { name: 'theirs' };
    const page = see.createSteamPage({
        g_rgCurrentTradeStatus: {
            me: { assets: meAssets },
            them: { assets: themAssets },
        },
        UserYou: { findAsset: () => foundByYou },
        UserThem: { findAsset: () => foundByThem },
    });

    assert.strictEqual(page.tradeAssets('me'), meAssets);
    assert.strictEqual(page.tradeAssets('them'), themAssets);
    assert.strictEqual(page.findTradeAsset('me', 1, 2, 3), foundByYou);
    assert.strictEqual(page.findTradeAsset('them', 1, 2, 3), foundByThem);
});
