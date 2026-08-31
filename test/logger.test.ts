import { test } from 'vitest';
import assert from 'node:assert';
import { logDOM, logger } from '../src/ui/logger.ts';

// The log is fed Steam's own strings at ten call sites -- item names, and Steam's error
// message text. An item name is written by whoever owned the item before you, so a trade is
// all it takes to put markup in front of `logDOM`. It must arrive as text.
test('markup in a log line is written as text, not parsed', () => {
    logger.innerHTML = '';

    logDOM('<b>x</b>');

    assert.strictEqual(logger.querySelectorAll('b').length, 0);
    assert.ok(logger.textContent?.includes('<b>x</b>'));
});

test('an image payload in an item name creates no element', () => {
    logger.innerHTML = '';

    logDOM('Selling <img src=x onerror="alert(1)"> for 0.03');

    assert.strictEqual(logger.querySelectorAll('img').length, 0);
    assert.ok(logger.textContent?.includes('<img src=x onerror="alert(1)">'));
});

// One element per line, appended -- not one growing string reparsed per line.
test('each line is its own child element', () => {
    logger.innerHTML = '';

    logDOM('first');
    logDOM('second');
    logDOM('third');

    assert.strictEqual(logger.childNodes.length, 3);
    assert.deepStrictEqual(
        Array.from(logger.children).map((child) => child.textContent),
        ['first', 'second', 'third'],
    );
});

test('a non-string log line is stringified rather than dropped', () => {
    logger.innerHTML = '';

    logDOM(42);

    assert.strictEqual(logger.textContent, '42');
});
