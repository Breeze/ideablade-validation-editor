// The editor's releases on GitHub, for installs that can't update themselves (macOS, the .deb): which release is
// newer than the running version, read from GitHub's list of releases, and comparing versions the semver way. Also
// which URLs count as the project's release pages, the only ones the renderer may ask to open.
//
// No Electron here, only data in and out, so the tests (releases.test.ts) run it on plain lists; updater.ts fetches
// the list and passes it in.

/** The repository's releases page, and the start every release page's URL has. */
export const RELEASES_PAGE = 'https://github.com/Breeze/ideablade-validation-editor/releases';
/** GitHub's API for the repository's releases, the newest first (drafts only show with a token, but are skipped anyway). */
export const RELEASES_API = 'https://api.github.com/repos/Breeze/ideablade-validation-editor/releases?per_page=30';

/** What newestRelease reads of a release in the API's list. */
export interface GitHubRelease {
  tag_name: string;
  html_url: string;
  draft?: boolean;
  prerelease?: boolean;
}

/** A semver version taken apart: major, minor, patch, and the pre-release identifiers (none for a release). */
interface Version {
  core: [number, number, number];
  pre: string[];
}

/** Reads "1.2.3", "v1.2.3-alpha.4" or "1.2.3+build"; undefined for anything else. */
function parseVersion(text: string): Version | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text.trim());
  if (!m) return undefined;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] };
}

/** True for a version (as in a tag, with or without its v) that semver can compare. */
export const isVersion = (text: string): boolean => parseVersion(text) !== undefined;

/** True for a pre-release version: one with a hyphen part, like 0.1.0-alpha.2. */
export const isPrereleaseVersion = (text: string): boolean => (parseVersion(text)?.pre.length ?? 0) > 0;

/**
 * Compares two versions by semver's precedence: negative when a is older, positive when newer, 0 when the same (build
 * metadata doesn't count). A pre-release comes before its release (1.0.0-rc.1 < 1.0.0); pre-release identifiers
 * compare one by one, numbers as numbers and below words (alpha.2 < alpha.10 < beta). An invalid version is older
 * than any valid one.
 */
export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) return (va ? 1 : 0) - (vb ? 1 : 0);
  for (let i = 0; i < 3; i++) if (va.core[i] !== vb.core[i]) return va.core[i] - vb.core[i];
  // A release is newer than its pre-releases.
  if (!va.pre.length || !vb.pre.length) return vb.pre.length - va.pre.length;
  for (let i = 0; i < Math.min(va.pre.length, vb.pre.length); i++) {
    const x = va.pre[i];
    const y = vb.pre[i];
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Number(x) - Number(y);
    if (xNum !== yNum) return xNum ? -1 : 1; // numbers before words
    return x < y ? -1 : 1; // words in ASCII order
  }
  return va.pre.length - vb.pre.length; // alpha < alpha.1
}

/** True for one of the project's pages on GitHub (a release, or the releases), the only URLs openReleasePage opens. */
export function isReleasePageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'github.com' && /^\/Breeze\/ideablade-validation-editor(\/|$)/.test(u.pathname)
      && !u.username && !u.password && !u.port;
  } catch {
    return false;
  }
}

/**
 * The newest release that is newer than `current`, from GitHub's list (`releases`, as the API returns it: anything
 * unexpected in it is skipped). Drafts never count; pre-releases (marked so on GitHub, or with a pre-release version)
 * only with `includePrereleases`. Undefined when there's nothing newer.
 */
export function newestRelease(releases: unknown, current: string, includePrereleases: boolean): { version: string; url: string } | undefined {
  if (!Array.isArray(releases)) return undefined;
  let newest: { version: string; url: string } | undefined;
  for (const r of releases as Partial<GitHubRelease>[]) {
    if (!r || typeof r.tag_name !== 'string' || typeof r.html_url !== 'string' || r.draft) continue;
    const version = r.tag_name.replace(/^v/, '');
    if (!isVersion(version) || !isReleasePageUrl(r.html_url)) continue;
    if (!includePrereleases && (r.prerelease || isPrereleaseVersion(version))) continue;
    if (compareVersions(version, current) <= 0) continue;
    if (!newest || compareVersions(version, newest.version) > 0) newest = { version, url: r.html_url };
  }
  return newest;
}
