// jQuery surface this script relies on that @types/jquery does not describe.
//
// One source: `delayedEach` is a plugin this script installs on $.fn itself (see
// src/tradeoffer/ui.ts, its only caller).
//
// This file also used to declare jQuery UI's `selectable`, the only widget the script ever
// used, because @types/jqueryui could not be a dependency -- it declares a non-generic global
// `interface JQuery`, which does not merge with @types/jquery v4's generic `JQuery<TElement>`,
// so the whole jQuery UI namespace failed to attach and degraded inference on any chain that
// passed through it. Nothing replaced that declaration: the selection it drove is now plain
// DOM code in src/inventory/ui.ts, and jQuery UI is no longer loaded at all.

declare global {
    interface JQuery<TElement = HTMLElement> {
        /**
         * Installed by this script in tradeoffer/ui.ts. Walks the matched elements one at
         * a time with `timeout` milliseconds between each, rather than all at once.
         */
        delayedEach(
            timeout: number,
            callback: (this: TElement, index: number, element: TElement) => void,
            continuous?: boolean,
        ): void;
    }
}

export {};
