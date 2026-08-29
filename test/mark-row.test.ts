import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

// markRow replaces nine identical `$('#'+appid+'_'+contextid+'_'+itemId).css('background',
// COLOR_X)` sites with one status name per call. The DOM write itself is not asserted here -
// the test harness's fake jQuery is a no-op, by design, so nothing records what it was
// called with - but the status-to-colour mapping it goes through is real data, and every
// status the nine call sites use resolves to the same colour they used to write by hand.

test('every row status the queues use resolves to a colour', () => {
    assert.strictEqual(typeof see.ROW_STATUS_COLORS.notChecked, 'string');
    assert.strictEqual(typeof see.ROW_STATUS_COLORS.pending, 'string');
    assert.strictEqual(typeof see.ROW_STATUS_COLORS.success, 'string');
    assert.strictEqual(typeof see.ROW_STATUS_COLORS.error, 'string');
});

test('the four statuses resolve to four different colours', () => {
    const colors = new Set(Object.values(see.ROW_STATUS_COLORS));

    assert.strictEqual(colors.size, 4, 'a status only means one thing if no two share a colour');
});

test('markRow does not throw for any of the statuses the queues use', () => {
    for (const status of Object.keys(see.ROW_STATUS_COLORS)) {
        assert.doesNotThrow(() => see.markRow('730_2_12345', status));
    }
});
