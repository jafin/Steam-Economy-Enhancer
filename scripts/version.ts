// Where @version comes from.
//
// Userscript engines compare @version to decide whether to offer an update, so the number
// only ever goes up and the ordering is not ours to invent -- it is semver precedence, which
// both Tampermonkey and Violentmonkey implement. The one rule that matters here: a
// pre-release sorts BELOW its release, so 7.4.0-dev.3 < 7.4.0. A build made after the v7.4.0
// tag must therefore carry the version it is heading *towards* (7.5.0-dev.3), never the one
// just released. Getting that backwards produces builds nobody is ever offered.
//
// The bump itself is read from the commit messages since the last tag, which is why this
// repo's conventional-commit discipline is load-bearing rather than cosmetic.
//
// The decision is a pure function of (last tag, messages since it, how many). The git
// plumbing that gathers those three things is at the bottom and is deliberately thin.

import { execFileSync } from 'node:child_process';

export type Bump = 'major' | 'minor' | 'patch';

export interface VersionInput {
    /** The version from the most recent tag, or a fallback when there is no tag yet. */
    baseVersion: string;
    /** Full commit messages -- subject and body -- since that tag. */
    messages: string[];
    /** How many commits since that tag. Zero means HEAD is the tag. */
    distance: number;
}

export interface DerivedVersion {
    /** The string to stamp into @version for a build made at this commit. */
    version: string;
    /**
     * The version to tag if a release is cut here -- `version` without its `-dev.N` suffix.
     * Null when there is nothing to release. A release build stamps this rather than
     * `version`, which is why the two are separate.
     */
    releaseVersion: string | null;
    /** The bump the commits warrant, or null when none of them is releasable. */
    bump: Bump | null;
    /** Whether these commits warrant cutting a release at all. */
    release: boolean;
}

// `type(scope)!: subject`. The optional `!` is conventional commits' in-header breaking
// marker; the scope is captured only to be discarded, since nothing here varies by scope.
const HEADER = /^(?<type>[a-z]+)(?:\([^)]*\))?(?<breaking>!)?:/;

// Conventional commits writes the footer with a space; the hyphenated spelling is common
// enough in the wild that refusing it would silently downgrade a major release to a patch.
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

const MINOR_TYPES = new Set(['feat']);
const PATCH_TYPES = new Set(['fix', 'perf']);

/** The strongest bump the given commit messages warrant, or null if none is releasable. */
export function releaseBumpFor(messages: string[]): Bump | null {
    let strongest: Bump | null = null;

    for (const message of messages) {
        const bump = bumpForMessage(message);

        if (bump === 'major') {
            return 'major';
        }

        if (bump === 'minor' || (bump === 'patch' && strongest === null)) {
            strongest = bump;
        }
    }

    return strongest;
}

function bumpForMessage(message: string): Bump | null {
    if (BREAKING_FOOTER.test(message)) {
        return 'major';
    }

    const header = message.split('\n', 1)[0] ?? '';
    const match = HEADER.exec(header);

    if (match?.groups == null) {
        return null;
    }

    const { type, breaking } = match.groups;

    if (breaking != null) {
        return 'major';
    }

    if (type != null && MINOR_TYPES.has(type)) {
        return 'minor';
    }

    if (type != null && PATCH_TYPES.has(type)) {
        return 'patch';
    }

    return null;
}

/** Raises one segment of a `major.minor.patch` version and zeroes everything below it. */
export function applyBump(base: string, bump: Bump): string {
    const [major = 0, minor = 0, patch = 0] = base.split('.').map(Number);

    switch (bump) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
    }
}

export function deriveVersion({ baseVersion, messages, distance }: VersionInput): DerivedVersion {
    // HEAD is the tag, so this build *is* that release.
    if (distance === 0) {
        return { version: baseVersion, releaseVersion: null, bump: null, release: false };
    }

    const bump = releaseBumpFor(messages);

    // A run of nothing but refactors and docs is not worth a release, but the build still
    // needs a number, and that number still has to sort above the tag it follows. Patch is
    // the floor for the dev version; `release` stays false so CI does not cut a tag for it.
    const next = applyBump(baseVersion, bump ?? 'patch');

    return {
        version: `${next}-dev.${distance}`,
        releaseVersion: bump === null ? null : next,
        bump,
        release: bump !== null,
    };
}

// stderr is discarded rather than inherited: `git describe` on a repository with no tags
// prints "fatal: No names found" before failing, and that is a case this handles rather than
// a case worth showing. A real failure still surfaces -- execFileSync throws on a non-zero
// exit whether or not anyone is listening to stderr.
function git(...args: string[]): string {
    return execFileSync('git', args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
}

/**
 * Reads the last `v*` tag and the commits since it, and derives the version from them.
 *
 * `fallbackVersion` is the base when the repository has no tag yet -- package.json's version,
 * which is the only thing that knows where the numbering was before tagging started.
 */
export function versionFromGit(fallbackVersion: string): DerivedVersion {
    let tag: string | null = null;

    try {
        tag = git('describe', '--tags', '--match', 'v*', '--abbrev=0');
    } catch {
        // No tag reachable from HEAD. Everything below falls back to counting from the root.
    }

    const range = tag == null ? 'HEAD' : `${tag}..HEAD`;
    const distance = Number(git('rev-list', '--count', range));

    // %B is the raw body, subject included. The unit separator keeps multi-line messages
    // whole -- a BREAKING CHANGE footer is on its own line, so splitting on newlines here
    // would lose the very thing that makes a release major.
    const log = git('log', '--format=%B%x1f', range);
    const messages = log
        .split('\x1f')
        .map((message) => message.trim())
        .filter((message) => message !== '');

    return deriveVersion({
        baseVersion: tag == null ? fallbackVersion : tag.replace(/^v/, ''),
        messages,
        distance,
    });
}
