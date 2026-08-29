import type { PricingRules } from './rules.ts';

// Steam Market fee arithmetic.
//
// Steam takes a cut of every sale, so the price a buyer pays and the price a seller
// receives are different numbers, and the script needs to move between them in both
// directions. These functions were spread between the 'Price helpers' region and the
// 'Steam Market / Inventory helpers' region -- the fee maths sat under a region named
// after something else entirely. It belongs with pricing.

// Calculate the price before fees (seller price) from the buyer price.
//
/**
 * What the fee maths returns.
 *
 * Every field is optional because the two wallet-less short circuits return partial
 * objects: CalculateFeeAmount answers { fees: 0 } and
 * CalculateAmountToSendForDesiredReceivedAmount answers { amount }. Both are reached only
 * when the wallet has no fee schedule at all, which is why the callers below can assert
 * the field they read -- they are behind the same guard.
 */
export interface FeeAmount {
    fees?: number;
    steam_fee?: number;
    publisher_fee?: number;
    amount?: number;
}

// Pure: the fee schedule and rounding rule come from `rules` rather than from the
// `market` singleton or the module-level `useRound`. SteamMarket.prototype.getPriceBeforeFees
// is a thin adapter over this for the call sites that use the market instance directly.
export function priceBeforeFees(price: number, item: any, rules: PricingRules) {
    let publisherFee = -1;

    if (item != null) {
        if (item.market_fee != null) {
            publisherFee = item.market_fee;
        } else if (item.description != null && item.description.market_fee != null) {
            publisherFee = item.description.market_fee;
        }
    }

    if (publisherFee == -1) {
        publisherFee =
            rules.walletInfo != null
                ? rules.walletInfo['wallet_publisher_fee_percent_default']
                : 0.1;
    }

    price = Math.round(price);
    const feeInfo = CalculateFeeAmount(price, publisherFee, rules.walletInfo, rules.useRound);

    return price > feeInfo.fees! ? price - feeInfo.fees! : 1;
}

// Calculate the buyer price from the seller price. See priceBeforeFees.
export function priceIncludingFees(price: number, item: any, rules: PricingRules) {
    let publisherFee = -1;

    if (item != null) {
        if (item.market_fee != null) {
            publisherFee = item.market_fee;
        } else if (item.description != null && item.description.market_fee != null) {
            publisherFee = item.description.market_fee;
        }
    }

    if (publisherFee == -1) {
        publisherFee =
            rules.walletInfo != null
                ? rules.walletInfo['wallet_publisher_fee_percent_default']
                : 0.1;
    }

    price = Math.round(price);
    const feeInfo = CalculateAmountToSendForDesiredReceivedAmount(
        price,
        publisherFee,
        rules.walletInfo,
        rules.useRound,
    );

    return feeInfo.amount;
}

export function CalculateFeeAmount(
    amount: number,
    publisherFee: number,
    walletInfo: any,
    useRound?: boolean,
): FeeAmount {
    if (walletInfo == null || !walletInfo['wallet_fee']) {
        return {
            fees: 0,
        };
    }

    publisherFee = publisherFee == null ? 0 : publisherFee;
    // Since CalculateFeeAmount has a Math.floor, we could be off a cent or two. Let's check:
    let iterations = 0; // shouldn't be needed, but included to be sure nothing unforseen causes us to get stuck
    let nEstimatedAmountOfWalletFundsReceivedByOtherParty = parseInt(
        String(
            (amount - parseInt(String(walletInfo['wallet_fee_base']))) /
                (parseFloat(String(walletInfo['wallet_fee_percent'])) +
                    parseFloat(String(publisherFee)) +
                    1),
        ),
    );
    let bEverUndershot = false;
    let fees = CalculateAmountToSendForDesiredReceivedAmount(
        nEstimatedAmountOfWalletFundsReceivedByOtherParty,
        publisherFee,
        walletInfo,
        useRound,
    );
    while (fees.amount! != amount && iterations < 10) {
        if (fees.amount! > amount) {
            if (bEverUndershot) {
                fees = CalculateAmountToSendForDesiredReceivedAmount(
                    nEstimatedAmountOfWalletFundsReceivedByOtherParty - 1,
                    publisherFee,
                    walletInfo,
                    useRound,
                );
                fees.steam_fee! += amount - fees.amount!;
                fees.fees! += amount - fees.amount!;
                fees.amount = amount;
                break;
            } else {
                nEstimatedAmountOfWalletFundsReceivedByOtherParty--;
            }
        } else {
            bEverUndershot = true;
            nEstimatedAmountOfWalletFundsReceivedByOtherParty++;
        }
        fees = CalculateAmountToSendForDesiredReceivedAmount(
            nEstimatedAmountOfWalletFundsReceivedByOtherParty,
            publisherFee,
            walletInfo,
            useRound,
        );
        iterations++;
    }
    // fees.amount should equal the passed in amount
    return fees;
}

// Clamps cur between min and max (inclusive).
export function clamp(cur: number, min: number, max: number) {
    if (cur < min) {
        cur = min;
    }

    if (cur > max) {
        cur = max;
    }

    return cur;
}

// Strangely named function, it actually works out the fees and buyer price for a seller price
// Updated for December 2025 Steam Market rule changes:
// - 12 specific currencies now use round instead of floor for fees
// - Global minimum fee increased to $0.01 for both Steam fee and publisher fee
// Reference: https://steamcommunity.com/groups/community_market/discussions/0/682988196226679356/
export function CalculateAmountToSendForDesiredReceivedAmount(
    receivedAmount: number,
    publisherFee: number,
    walletInfo: any,
    useRound?: boolean,
): FeeAmount {
    if (walletInfo == null || !walletInfo['wallet_fee']) {
        return {
            amount: receivedAmount,
        };
    }

    // Select the appropriate rounding function based on currency.
    const roundFee = useRound ? Math.round : Math.floor;

    // December 2025 change: Both Steam fee and publisher fee now have a minimum of $0.01.
    // The wallet_fee_minimum from Steam represents $0.01 in the user's local currency.
    // Previously, publisher fee minimum was hardcoded to 1 (the smallest currency unit),
    // but now it should also be at least $0.01 equivalent in local currency.
    const minFee = walletInfo['wallet_fee_minimum'] || 1;

    publisherFee = publisherFee == null ? 0 : publisherFee;

    // IMPORTANT: Apply rounding/flooring BEFORE comparing with minimum fee.
    // Correct order per Steam's December 2025 rule changes:
    // 1. Calculate percentage fee (e.g., 0.05 * receivedAmount)
    // 2. Add base fee (usually 0)
    // 3. Apply round/floor based on currency
    // 4. Compare with minimum fee and take maximum
    const nSteamFee = Math.max(
        parseInt(
            String(
                roundFee(
                    receivedAmount * parseFloat(String(walletInfo['wallet_fee_percent'])) +
                        parseInt(String(walletInfo['wallet_fee_base'])),
                ),
            ),
        ),
        minFee,
    );

    // Publisher fee: same logic, round/floor first, then compare with minFee
    const nPublisherFee =
        publisherFee > 0
            ? Math.max(parseInt(String(roundFee(receivedAmount * publisherFee))), minFee)
            : 0;
    const nAmountToSend = receivedAmount + nSteamFee + nPublisherFee;
    return {
        steam_fee: nSteamFee,
        publisher_fee: nPublisherFee,
        fees: nSteamFee + nPublisherFee,
        amount: parseInt(String(nAmountToSend)),
    };
}
