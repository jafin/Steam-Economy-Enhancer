import { test } from 'vitest';
import assert from 'node:assert';
import * as main from '../src/main.ts';

// The point of TASK-11: importing src/main.ts must be inert, and everything the userscript
// does at startup must be reachable only by calling the bootstrap() it exports. Before the
// split, importing main.ts injected the stylesheet unconditionally and exported no
// bootstrap function at all.

test('importing src/main.ts does not inject the stylesheet', () => {
    assert.strictEqual(
        document.head.querySelectorAll('style').length,
        0,
        'module evaluation must not touch the DOM',
    );
});

test('bootstrap() is exported as a callable function', () => {
    assert.strictEqual(typeof main.bootstrap, 'function');
});

test('calling bootstrap() is what injects the stylesheet', () => {
    const before = document.head.querySelectorAll('style').length;

    main.bootstrap();

    assert.strictEqual(
        document.head.querySelectorAll('style').length,
        before + 1,
        'bootstrap() runs the startup work module-evaluation used to run',
    );
});
