// A stand-in for jQuery's $.ajax.
//
// The suite runs real jQuery, so $.ajax is the real thing and would reach Steam over the
// network -- importing src/main.ts alone runs the market page's bootstrap on
// $(document).ready(). The old node --test harness never had this problem only because its
// entire jQuery was a no-op stub.
//
// Nothing legitimately needs $.ajax here: every test that needs request() to do something
// injects its own transport. This records calls rather than throwing, so a stray call fails
// the test that made it instead of breaking module import for the whole suite.

export const ajaxCalls: unknown[] = [];

export function installFakeAjax(jq: any): void {
    jq.ajax = (settings: unknown) => {
        ajaxCalls.push(settings);
        return { done: () => undefined, fail: () => undefined, always: () => undefined };
    };
}
