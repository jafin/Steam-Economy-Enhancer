import type { MonkeyUserScript } from 'vite-plugin-monkey';
import { ICON } from './src/icon.ts';

// The userscript metadata block, previously the comment header at the top of code.user.js.
//
// Two things changed when this fork stopped tracking upstream. The identity fields point at
// jafin rather than Nuklon -- @name included, so an install of this fork does not collide
// with an install of upstream -- and @downloadURL/@updateURL point at this repository.
// Leaving those two at their old values would have auto-updated every user of this fork back
// to upstream on the next check, silently erasing the fork.
//
// @version is not set here: it is derived from the git tag in CI, falling back to
// package.json for local builds. See vite.config.ts.
//
// The @require list is six entries, not the original eight. jquery-observe and checkboxes.js
// were pinned to raw.githubusercontent.com commit URLs -- a host GitHub does not support as
// a CDN -- and are now vendored under src/vendor/ and bundled. Order matters here and is
// preserved by vite-plugin-monkey: jQuery UI must load after jQuery.
export const userscript: MonkeyUserScript = {
    name: 'Steam Economy Enhancer (jafin)',
    namespace: 'https://github.com/jafin',
    icon: ICON,
    description: 'Enhances the Steam Inventory and Steam Market.',
    author: 'Jason Finch',
    license: 'MIT',
    match: [
        'https://steamcommunity.com/id/*/inventory*',
        'https://steamcommunity.com/profiles/*/inventory*',
        'https://steamcommunity.com/market*',
        'https://steamcommunity.com/tradeoffer*',
    ],
    require: [
        'https://cdnjs.cloudflare.com/ajax/libs/jquery/4.0.0/jquery.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.14.2/jquery-ui.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/async/3.2.6/async.js',
        'https://cdnjs.cloudflare.com/ajax/libs/localforage/1.10.0/localforage.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/luxon/3.5.0/luxon.min.js',
        'https://cdnjs.cloudflare.com/ajax/libs/list.js/2.3.1/list.js',
    ],
    grant: ['unsafeWindow'],
    homepage: 'https://github.com/jafin/Steam-Economy-Enhancer',
    homepageURL: 'https://github.com/jafin/Steam-Economy-Enhancer',
    supportURL: 'https://github.com/jafin/Steam-Economy-Enhancer/issues',
    downloadURL:
        'https://raw.githubusercontent.com/jafin/Steam-Economy-Enhancer/master/dist/code.user.js',
    updateURL:
        'https://raw.githubusercontent.com/jafin/Steam-Economy-Enhancer/master/dist/code.user.js',
};

/** Bare import specifier -> the window global its @require script defines. */
export const externalGlobals = {
    jquery: 'jQuery',
    async: 'async',
    localforage: 'localforage',
    luxon: 'luxon',
    'list.js': 'List',
};
