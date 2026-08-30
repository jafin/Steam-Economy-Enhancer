import { test } from 'vitest';
import assert from 'node:assert';
import $ from 'jquery';
import { ROW_STATUS_COLORS } from '../src/constants.ts';
import { markRow } from '../src/ui/index.ts';

// markRow replaces nine identical `$('#'+appid+'_'+contextid+'_'+itemId).css('background',
// COLOR_X)` sites with one status name per call. Both halves of that are checked here: the
// status-to-colour mapping it goes through, and the write itself, which lands on a real
// element - jQuery and the DOM are both real in this harness, and only Steam's page globals
// and $.ajax are faked. See test/setup.ts.

test('every row status the queues use resolves to a colour', () => {
    assert.strictEqual(typeof ROW_STATUS_COLORS.notChecked, 'string');
    assert.strictEqual(typeof ROW_STATUS_COLORS.pending, 'string');
    assert.strictEqual(typeof ROW_STATUS_COLORS.success, 'string');
    assert.strictEqual(typeof ROW_STATUS_COLORS.error, 'string');
});

test('the four statuses resolve to four different colours', () => {
    const colors = new Set(Object.values(ROW_STATUS_COLORS));

    assert.strictEqual(colors.size, 4, 'a status only means one thing if no two share a colour');
});

test('markRow does not throw for any of the statuses the queues use', () => {
    for (const status of Object.keys(ROW_STATUS_COLORS)) {
        assert.doesNotThrow(() => markRow('730_2_12345', status));
    }
});

test('markRow paints the element carrying the asset key, and each status paints it its own way', () => {
    document.body.innerHTML =
        '<div class="itemHolder"><div id="730_2_12345" class="item"></div></div>';

    markRow('730_2_12345', 'success');
    const painted = $('#730_2_12345').attr('style');

    markRow('730_2_12345', 'error');
    const repainted = $('#730_2_12345').attr('style');

    assert.ok(painted, 'a marked row should carry a background');
    assert.notStrictEqual(painted, repainted, 'two statuses that looked alike would say nothing');
});
