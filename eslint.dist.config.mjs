import userscripts from 'eslint-plugin-userscripts';

// Lints the *generated* artifact, and only its `// ==UserScript==` metadata block.
//
// eslint-plugin-userscripts used to lint the hand-written header in code.user.js. That
// header is now generated from userscript.config.ts, so the plugin is pointed here instead
// -- same protection, applied where the header actually exists. Deliberately a separate
// config with no `js.configs.recommended`: the artifact is bundler output and should not be
// judged by source style rules.
export default [
    {
        files: ['dist/*.user.js'],
        plugins: { userscripts: { rules: userscripts.rules } },
        rules: { ...userscripts.configs.recommended.rules },
        settings: {
            userscriptVersions: { greasemonkey: '*', tampermonkey: '*', violentmonkey: '*' },
        },
    },
];
