// Test environment setup, run before any test module loads.
//
// src/main.ts's module body no longer does the userscript's startup work itself -- that
// moved into bootstrap(), called only by src/entry.ts (see test/load.test.ts) and directly
// by test/bootstrap.test.ts -- but Steam's page globals still have to exist before *any*
// test file's imports run. steam/instance.ts builds the live steamPage adapter from
// unsafeWindow and reads isLoggedIn/currentPage off it unconditionally at module-evaluation
// time, and it sits under most of src/, not just main.ts: pricing/algorithms.ts is one of
// the modules test files now import directly that still reaches it.
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
