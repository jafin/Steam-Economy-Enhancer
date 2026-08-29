import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
    {
        // dist/ is generated; it is linted separately by `pnpm lint:dist`, which checks the
        // generated userscript metadata block that no longer exists in source.
        ignores: ['dist/**', 'node_modules/**', 'src/vendor/*.js'],
    },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        languageOptions: {
            globals: {
                document: 'readonly',
                window: 'readonly',
                console: 'readonly',
                location: 'readonly',
                navigator: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                localStorage: 'readonly',
                sessionStorage: 'readonly',
                MutationObserver: 'readonly',
                XMLHttpRequest: 'readonly',
                Element: 'readonly',
                Event: 'readonly',
                Text: 'readonly',
                HTMLElement: 'readonly',
                HTMLInputElement: 'readonly',
                unsafeWindow: 'readonly',
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            // The Steam page boundary is deliberately `any`; see src/steam/globals.d.ts.
            '@typescript-eslint/no-explicit-any': 'off',
            // `const el = this` inside a jQuery .each() callback is the idiom this codebase
            // is written in, and the callback's `this` is the element. The rule is aimed at
            // class-based TypeScript, where the alias hides a binding bug; here it would only
            // force a rewrite of working jQuery.
            '@typescript-eslint/no-this-alias': 'off',
        },
    },
    prettier,
);
