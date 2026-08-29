// jQuery surface this script relies on that @types/jquery does not describe.
//
// Two sources. `delayedEach` is a plugin this script installs on $.fn itself (see the foot
// of main.ts). `selectable` comes from the jQuery UI @require.
//
// @types/jqueryui is deliberately NOT a dependency. It declares a non-generic global
// `interface JQuery`, which does not merge with @types/jquery v4's generic `JQuery<TElement>`
// -- so the whole jQuery UI namespace fails to attach and, worse, degrades inference on any
// chain that passes through it. The script uses exactly one jQuery UI method, so declaring
// that one here is both smaller and more accurate than carrying a mismatched types package.

interface SelectableUIParams {
    /** The element currently being selected. */
    selecting: HTMLElement;
    selected?: HTMLElement;
    unselecting?: HTMLElement;
}

interface SelectableOptions {
    /** Selector for the child elements that can be selected. */
    filter?: string;
    selecting?: (event: JQuery.TriggeredEvent, ui: SelectableUIParams) => void;
    selected?: (event: JQuery.TriggeredEvent, ui: SelectableUIParams) => void;
    unselecting?: (event: JQuery.TriggeredEvent, ui: SelectableUIParams) => void;
    stop?: (event: JQuery.TriggeredEvent) => void;
}

declare global {
    interface JQuery<TElement = HTMLElement> {
        /** jQuery UI selectable widget, loaded via @require. */
        selectable(options?: SelectableOptions): JQuery<TElement>;

        /**
         * Installed by this script at the foot of main.ts. Walks the matched elements one at
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
