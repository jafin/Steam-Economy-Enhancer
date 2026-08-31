import { test } from 'vitest';
import assert from 'node:assert';
import { applyBump, deriveVersion, releaseBumpFor } from '../scripts/version.ts';

// The version a build stamps into @version is a pure function of the last tag, the commit
// messages since it, and how many there are. That is what is tested here -- the git plumbing
// that feeds it is a thin wrapper around `git describe` and `git log`, and is not.
//
// Userscript engines compare @version to decide whether to offer an update, and under semver
// precedence a pre-release sorts BELOW its release: 7.4.0-dev.3 < 7.4.0. So a dev build must
// carry the version it is heading towards, never the one just released. Several of these
// tests exist only to hold that ordering closed.

test('a feat is a minor bump', () => {
    assert.strictEqual(releaseBumpFor(['feat(items): add getItemName']), 'minor');
});

test('a fix is a patch bump', () => {
    assert.strictEqual(releaseBumpFor(['fix(market): guard the price read']), 'patch');
});

test('a perf is a patch bump', () => {
    assert.strictEqual(releaseBumpFor(['perf(items): find duplicates in one pass']), 'patch');
});

test('an exclamation mark in the header is a major bump', () => {
    assert.strictEqual(releaseBumpFor(['feat(api)!: drop the old settings shape']), 'major');
});

test('BREAKING CHANGE in the body is a major bump', () => {
    const message = 'refactor(storage): rename the cache\n\nBREAKING CHANGE: keys moved.';

    assert.strictEqual(releaseBumpFor([message]), 'major');
});

test('BREAKING-CHANGE with a hyphen is accepted too', () => {
    const message = 'refactor: rename\n\nBREAKING-CHANGE: keys moved.';

    assert.strictEqual(releaseBumpFor([message]), 'major');
});

test('the strongest bump present wins', () => {
    const messages = [
        'fix(market): guard the price read',
        'feat(items): add getItemName',
        'docs: reattach the comments',
    ];

    assert.strictEqual(releaseBumpFor(messages), 'minor');
});

test('refactor, docs, build, test and chore are not releasable on their own', () => {
    const messages = [
        'refactor(items): resolve tags in one place',
        'docs: reattach the comments that drifted',
        'build(ts): turn on noUnusedLocals',
        'test: cover the retry path',
        'chore: bump prettier',
    ];

    assert.strictEqual(releaseBumpFor(messages), null);
});

test('a subject that is not a conventional commit is ignored', () => {
    assert.strictEqual(releaseBumpFor(['Merge pull request #331 from SeRi0uS007/master']), null);
});

test('applyBump zeroes the segments below the one it raises', () => {
    assert.strictEqual(applyBump('7.4.3', 'major'), '8.0.0');
    assert.strictEqual(applyBump('7.4.3', 'minor'), '7.5.0');
    assert.strictEqual(applyBump('7.4.3', 'patch'), '7.4.4');
});

test('HEAD sitting on the tag is the release itself, with no suffix', () => {
    const result = deriveVersion({
        baseVersion: '7.4.0',
        messages: [],
        distance: 0,
    });

    assert.strictEqual(result.version, '7.4.0');
    assert.strictEqual(result.release, false);
});

test('commits past the tag carry the version they are heading towards', () => {
    const result = deriveVersion({
        baseVersion: '7.4.0',
        messages: ['feat(items): add getItemName', 'fix(market): guard the price read'],
        distance: 3,
    });

    assert.strictEqual(result.version, '7.5.0-dev.3');
    assert.strictEqual(result.bump, 'minor');
    assert.strictEqual(result.release, true);
});

// A release build stamps the clean number, not the -dev.N one it would have carried a commit
// earlier. Keeping the two apart is what lets CI decide and build in one pass.
test('the release version is the dev version without its suffix', () => {
    const result = deriveVersion({
        baseVersion: '7.4.0',
        messages: ['feat(items): add getItemName'],
        distance: 3,
    });

    assert.strictEqual(result.releaseVersion, '7.5.0');
    assert.strictEqual(result.version, '7.5.0-dev.3');
});

test('there is no release version when nothing is releasable', () => {
    const result = deriveVersion({
        baseVersion: '7.4.0',
        messages: ['docs: reattach the comments'],
        distance: 2,
    });

    assert.strictEqual(result.releaseVersion, null);
});

// The ordering this whole scheme exists to get right. A dev build must be offered to someone
// already on the release it follows, which means sorting above it.
test('a dev version sorts above the tag it follows and below its own release', () => {
    const { version } = deriveVersion({
        baseVersion: '7.4.0',
        messages: ['feat: something'],
        distance: 3,
    });

    assert.strictEqual(compareVersions('7.4.0', version) < 0, true, `7.4.0 < ${version}`);
    assert.strictEqual(compareVersions(version, '7.5.0') < 0, true, `${version} < 7.5.0`);
});

// A dev build off nothing but refactors still needs a number, and it still has to sort above
// the tag -- so the floor is a patch bump even though `release` says there is nothing to cut.
test('an unreleasable run of commits still gets a sortable dev version', () => {
    const result = deriveVersion({
        baseVersion: '7.4.0',
        messages: ['refactor: collapse the sell-all functions'],
        distance: 2,
    });

    assert.strictEqual(result.version, '7.4.1-dev.2');
    assert.strictEqual(result.bump, null);
    assert.strictEqual(result.release, false);
    assert.strictEqual(compareVersions('7.4.0', result.version) < 0, true);
});

test('with no tag yet, the fallback version is the base', () => {
    const result = deriveVersion({
        baseVersion: '7.3.2',
        messages: ['feat: the whole typescript rewrite'],
        distance: 27,
    });

    assert.strictEqual(result.version, '7.4.0-dev.27');
});

// Semver precedence, enough of it to assert the ordering above. Numeric segments compare
// numerically; a version with a pre-release suffix sorts below the same version without one.
function compareVersions(a: string, b: string): number {
    const [aCore = '', aPre] = a.split('-');
    const [bCore = '', bPre] = b.split('-');

    const aParts = aCore.split('.').map(Number);
    const bParts = bCore.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        if (aParts[i] !== bParts[i]) {
            return aParts[i] - bParts[i];
        }
    }

    if (aPre === bPre) {
        return 0;
    }

    return aPre === undefined ? 1 : bPre === undefined ? -1 : aPre < bPre ? -1 : 1;
}
