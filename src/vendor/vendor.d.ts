// Hand-written types for the two vendored jQuery plugins. Neither ships any,
// and neither exists on DefinitelyTyped. Only the surface this script actually
// uses is declared -- both plugins do more than this.

declare global {
    interface JQuery<TElement = HTMLElement> {
        /**
         * jquery-observe. Watches the matched elements for DOM mutations.
         *
         * `options` is a space-separated list of MutationObserver option names
         * plus the plugin's own `added`/`removed`, e.g. `'childlist subtree'`.
         * The handler is invoked with `this` bound to the matched element.
         */
        observe(
            options: string | Record<string, unknown>,
            handler: (this: TElement, record: MutationRecord) => void,
        ): JQuery<TElement>;
        observe(
            options: string | Record<string, unknown>,
            selector: string,
            handler: (this: TElement, record: MutationRecord) => void,
        ): JQuery<TElement>;

        /** jquery-observe. Tears down observers previously registered by `observe`. */
        disconnect(
            options?: string | Record<string, unknown>,
            selector?: string,
            handler?: (this: TElement, record: MutationRecord) => void,
        ): JQuery<TElement>;

        /**
         * checkboxes.js. Bulk operations over the checkboxes in the matched context.
         *
         * `'range'` toggles shift-click range selection on or off; the other
         * actions take no second argument.
         */
        checkboxes(action: 'range', enabled: boolean): JQuery<TElement>;
        checkboxes(
            action: 'check' | 'uncheck' | 'toggle' | 'max' | 'disableLastChecked',
            value?: unknown,
        ): JQuery<TElement>;
    }
}

export {};
