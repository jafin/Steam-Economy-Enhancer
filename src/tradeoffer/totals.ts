// Totals for one side of a trade offer.
//
// A trade offer summary is the same aggregation for both sides, so it is written once and
// run over each. `resolve` turns an asset into what is known about it, which is what lets
// this be tested without a page behind it.

//#region Trade offer totals
// What one side of a trade offer holds, and what it is worth.
//
// `resolve` turns an asset into `{ name, type, originalAmount, amount, price }`, or null
// when the page cannot say what the asset is. Everything that needs the page lives in
// there, so the counting and the total are just a function of the offer.
export function aggregateTradeOfferAssets(assets, resolve) {
    const counts = new Map();
    let totalPrice = 0;

    for (let i = 0; i < assets.length; i++) {
        const item = resolve(assets[i]);
        const text = getTradeOfferAssetText(item);

        counts.set(text, (counts.get(text) || 0) + 1);

        if (item != null && item.price > 0) {
            totalPrice += item.price;
        }
    }

    const items: any[] = [];
    counts.forEach((count, text) => {
        items.push({ text: text, count: count });
    });

    return { items: items, totalPrice: totalPrice };
}

// `3x Gems`, `Sackboy (Trading Card)`, or `Unknown Item` when the page cannot say what
// the asset is. A partly used stack is named by how much of it is in the offer.
export function getTradeOfferAssetText(item) {
    if (item == null) {
        return 'Unknown Item';
    }

    let text = '';

    if (item.originalAmount != null && item.amount != null) {
        const usedAmount = parseInt(item.originalAmount) - parseInt(item.amount);
        text += `${usedAmount.toString()}x `;
    }

    text += item.name;

    if (item.type != null && item.type.length > 0) {
        text += ` (${item.type})`;
    }

    return text;
}
