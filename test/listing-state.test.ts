import { test } from 'vitest';
import assert from 'node:assert';
import * as see from '../src/main.ts';

test('a listing that was never priced has no state', () => {
    const state = see.createListingState();

    assert.strictEqual(state.get('123'), undefined);
});

test('a listing keeps the price and verdict it was set with', () => {
    const state = see.createListingState();

    state.set('123', { sellPrice: 250, verdict: 'overpriced' });

    assert.deepStrictEqual(state.get('123'), { sellPrice: 250, verdict: 'overpriced' });
});

test('setting a listing again keeps the fields the second set leaves out', () => {
    const state = see.createListingState();

    state.set('123', { sellPrice: 250 });
    state.set('123', { verdict: 'fair' });

    assert.deepStrictEqual(state.get('123'), { sellPrice: 250, verdict: 'fair' });
});

test('listings do not share state', () => {
    const state = see.createListingState();

    state.set('123', { sellPrice: 250 });
    state.set('456', { sellPrice: 900 });

    assert.strictEqual(state.get('123').sellPrice, 250);
    assert.strictEqual(state.get('456').sellPrice, 900);
});

test('a listing id is the same key whether it arrives as a number or a string', () => {
    const state = see.createListingState();

    state.set(123, { sellPrice: 250 });

    assert.strictEqual(state.get('123').sellPrice, 250);
});

test('a listing asking more than the best price is overpriced', () => {
    assert.strictEqual(see.getListingVerdict(100, 150), 'overpriced');
});

test('a listing asking less than the best price is underpriced', () => {
    assert.strictEqual(see.getListingVerdict(150, 100), 'underpriced');
});

test('a listing asking the best price is fair', () => {
    assert.strictEqual(see.getListingVerdict(100, 100), 'fair');
});

test('a listing asking more than the best price has a positive delta', () => {
    assert.strictEqual(see.getListingPriceDelta(233, 275), 42);
});

test('a listing asking less than the best price has a negative delta', () => {
    assert.strictEqual(see.getListingPriceDelta(233, 200), -33);
});

test('a listing asking the best price has no delta', () => {
    assert.strictEqual(see.getListingPriceDelta(233, 233), 0);
});

// The baseline is the decision recorded in ADR 0001, and getting it wrong is invisible:
// the label still renders, it just quietly measures against the wrong price. This pins
// which of the two prices in scope at the call site is the one subtracted.
test('the delta is measured from the best price, not from any offset price', () => {
    const bestPrice = 233;
    const relistPriceWithNegativeOffset = 228;

    assert.strictEqual(see.getListingPriceDelta(bestPrice, 275), 42);
    assert.notStrictEqual(see.getListingPriceDelta(relistPriceWithNegativeOffset, 275), 42);
});

test('a positive delta is rendered with a plus sign', () => {
    assert.strictEqual(see.formatPriceDelta(42), '+42');
});

test('a negative delta is rendered with a minus sign', () => {
    assert.strictEqual(see.formatPriceDelta(-33), '−33');
});

test('a zero delta renders as nothing', () => {
    assert.strictEqual(see.formatPriceDelta(0), '');
});
