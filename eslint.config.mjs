import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
import userscripts from 'eslint-plugin-userscripts';

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
        },
    },
    {
        // The generated artifact. Only the userscript metadata rules apply here -- this is
        // where eslint-plugin-userscripts earns its place now that the header is generated
        // from userscript.config.ts rather than hand-written.
        files: ['dist/*.user.js'],
        plugins: { userscripts: { rules: userscripts.rules } },
        rules: { ...userscripts.configs.recommended.rules },
        settings: {
            userscriptVersions: { greasemonkey: '*', tampermonkey: '*', violentmonkey: '*' },
        },
    },
    prettier,
);
