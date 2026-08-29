// Test environment setup.
//
// src/main.ts does a lot of work at module-evaluation time: it reads Steam's page globals,
// constructs SteamMarket, creates two localforage instances, builds a detached logger
// element and injects a stylesheet. None of it is guarded, so the module cannot be imported
// until those globals exist. This file installs them before any test module loads.
//
// happy-dom supplies a real document and window, so unlike the old node --test harness the
// DOM here is genuine -- fakes are needed only for Steam's own globals.

import $ from 'jquery';
import { fakeSteamWindow } from './fakes/steamGlobals.ts';

// The vendored jQuery plugins attach to the jQuery global when src/main.ts imports them,
// which in a browser is satisfied by the @require. Here it has to be done by hand, and it
// has to happen before main.ts is imported.
(globalThis as any).jQuery = $;
(globalThis as any).$ = $;

(globalThis as any).unsafeWindow = fakeSteamWindow();

// Real jQuery means a real $.ajax, and importing src/main.ts runs the market page's
// bootstrap on $(document).ready() -- which reaches Steam over the network. The old
// node --test harness never had this problem because its whole jQuery was a no-op stub.
//
// Every test that needs request() to do something injects its own transport, so nothing
// legitimately needs $.ajax here. It is replaced with a recorder rather than a throw so an
// accidental call fails the test that made it rather than breaking module import for all
// of them; assert on ajaxCalls if you want to pin that down.
export const ajaxCalls: unknown[] = [];

($ as any).ajax = (settings: unknown) => {
    ajaxCalls.push(settings);
    return { done: () => undefined, fail: () => undefined, always: () => undefined };
};
