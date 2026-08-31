// The item caches.
//
// Prices and order books are cached so a page full of items does not re-ask Steam for every
// one of them. There are two stores and only one of them is used.
//
// The session store is a rolling one. localforage is backed by IndexedDB, which survives a
// tab closing, so 'session' has to be emulated: a counter in sessionStorage names which of
// five databases this browsing session owns, and that database is cleared when the session
// starts. Opening a new tab therefore gets a fresh cache rather than yesterday's prices.
//
// storagePersistent is created and never read or written. It has been dead for as long as
// the git history goes back. It is left in place here rather than removed, because deleting
// it would stop the see_persistent database being created and that is a behaviour change,
// however inert -- it belongs in its own commit, not in a move.

import localforage from 'localforage';

import { getSessionStorageItem, setSessionStorageItem } from './index.ts';
import { logConsole } from '../ui/logger.ts';
import { getSetting, setSetting, SETTING_LAST_CACHE } from '../settings/index.ts';

export const storagePersistent = localforage.createInstance({
    name: 'see_persistent',
});

let session: LocalForage | undefined;

// Picks this browsing session's database and, when the session is new, rotates onto the next
// of the five and empties it.
//
// This does not work the same as the 'normal' session storage because opening a new browser
// session/tab will clear the cache. For this reason, a rolling cache is used.
function createRollingSession(): LocalForage {
    const currentUrl = new URL(window.location.href);
    const noCache = currentUrl.searchParams.get('no-cache') != null;

    if (getSessionStorageItem('SESSION') == null || noCache) {
        let lastCache = getSetting(SETTING_LAST_CACHE);
        if (lastCache >= 5) {
            lastCache = 0;
        }

        setSetting(SETTING_LAST_CACHE, lastCache + 1);

        const rotated = localforage.createInstance({
            name: `see_session_${lastCache}`,
        });

        rotated.clear(); // Clear any previous data.
        setSessionStorageItem('SESSION', lastCache);

        return rotated;
    }

    return localforage.createInstance({
        name: `see_session_${getSessionStorageItem('SESSION')}`,
    });
}

/**
 * The session cache, built on first use.
 *
 * This module used to do all of the above at module evaluation: read window.location.href,
 * create two localforage instances, write a setting and clear a database. That was the one
 * remaining contradiction of main.ts's "importing this module is inert" contract, and the
 * reason test/setup.ts has to install Steam's globals before any test file's imports run.
 *
 * `export let storageSession: any` also erased the type for every consumer -- steam/market.ts
 * called .getItem/.setItem/.clear on it with nothing checking any of them. Returning
 * LocalForage fixes that at the same time.
 *
 * The rotation still happens exactly once per page load rather than at first use: bootstrap()
 * calls this once. Left purely lazy, a page that never prices anything would never rotate and
 * SETTING_LAST_CACHE would stop advancing -- a behavioural change, and not one this commit is
 * for. The laziness is what makes the module inert to import; the bootstrap call is what keeps
 * the timing.
 */
export function storageSessionInstance(): LocalForage {
    if (session === undefined) {
        session = createRollingSession();
    }

    return session;
}

// Empties the price and order book cache for this browsing session.
//
// The cache is deliberately long-lived -- it exists so a page full of items does not re-ask
// Steam for every one of them -- which also means a copy taken while Steam was answering
// oddly is priced against for the rest of the session. Rotating to a fresh database needs a
// new tab or the no-cache parameter above; this is the same thing on demand, offered as a
// button in the settings dialog.
//
// Fail-soft in the same way as the wrappers in ./index.ts. localforage rejects when the
// browser refuses site data, and this is called straight from a click handler where there is
// nothing above it to catch a rejection. The caller gets false and can say so.
export function clearPriceCache(): Promise<boolean> {
    return storageSessionInstance()
        .clear()
        .then(() => true)
        .catch((e) => {
            logConsole(`Failed to clear the price cache, ${e}.`);
            return false;
        });
}
