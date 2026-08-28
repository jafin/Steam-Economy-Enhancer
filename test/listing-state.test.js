'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadUserscript } = require('./harness.js');

const see = loadUserscript();

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
