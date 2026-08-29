// Test environment setup, run before any test module loads.
//
// src/main.ts does a lot of work at module-evaluation time: it reads Steam's page globals,
// constructs SteamMarket, creates two localforage instances, builds a detached logger
// element and injects a stylesheet. None of it is guarded, so the module cannot be imported
// until those globals exist.
//
// happy-dom supplies a real document and window, and jQuery, localforage, luxon, async and
// list.js all run for real. Only two things are faked: Steam's own page globals, which have
// no real implementation available, and $.ajax, which has one and must not be allowed to
// use it. See test/fakes/.

import $ from 'jquery';
import { fakeSteamWindow } from './fakes/steamGlobals.ts';
import { installFakeAjax } from './fakes/ajax.ts';

// The vendored jQuery plugins attach to the jQuery global as src/main.ts imports them, which
// in a browser the @require satisfies. Here it has to be done by hand, and before main.ts is
// imported -- module imports are evaluated before the importing module's body.
(globalThis as any).jQuery = $;
(globalThis as any).$ = $;

(globalThis as any).unsafeWindow = fakeSteamWindow();

installFakeAjax($);
