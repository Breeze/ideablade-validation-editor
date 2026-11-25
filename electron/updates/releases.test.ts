// Tests for releases.ts (node --test, compiled to dist-electron/updates/releases.test.js; see scripts/test-main.mjs).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compareVersions, isReleasePageUrl, newestRelease, type GitHubRelease } from './releases';

const page = (tag: string): string => `https://github.com/Breeze/ideablade-validation-editor/releases/tag/${tag}`;
const release = (tag: string, more: Partial<GitHubRelease> = {}): GitHubRelease => ({
  tag_name: tag,
  html_url: page(tag),
  prerelease: tag.includes('-'),
  ...more,
});

describe('comparing versions', () => {
  it('orders them the semver way', () => {
    const ordered = [
      '0.1.0-alpha', '0.1.0-alpha.1', '0.1.0-alpha.2', '0.1.0-alpha.10', '0.1.0-alpha.beta', '0.1.0-beta', '0.1.0-beta.2',
      '0.1.0-rc.1', '0.1.0', '0.1.1', '0.2.0', '0.10.0', '1.0.0',
    ];
    for (let i = 0; i < ordered.length; i++) {
      for (let j = 0; j < ordered.length; j++) {
        const c = compareVersions(ordered[i], ordered[j]);
        assert.equal(Math.sign(c), Math.sign(i - j), `${ordered[i]} vs ${ordered[j]}`);
      }
    }
  });

  it('takes a tag\'s v, ignores build metadata, and puts invalid versions first', () => {
    assert.equal(compareVersions('v1.2.3', '1.2.3'), 0);
    assert.equal(compareVersions('1.2.3+abc', '1.2.3'), 0);
    assert.ok(compareVersions('nightly', '0.0.1') < 0);
    assert.ok(compareVersions('1.0.0', '1.0') > 0);
  });
});

describe('the newest release', () => {
  // As the API lists them: the newest first, but not necessarily in version order.
  const releases = [
    release('v0.2.0-beta.1'),
    release('v0.1.1'),
    release('v0.3.0', { draft: true }),
    release('v0.1.0'),
    release('v0.1.0-alpha.2'),
    release('v0.1.0-alpha.1'),
  ];

  it('is the newest newer one, pre-releases included or not', () => {
    assert.deepEqual(newestRelease(releases, '0.1.0-alpha.2', true), { version: '0.2.0-beta.1', url: page('v0.2.0-beta.1') });
    assert.deepEqual(newestRelease(releases, '0.1.0-alpha.2', false), { version: '0.1.1', url: page('v0.1.1') });
    assert.deepEqual(newestRelease(releases, '0.1.0', false), { version: '0.1.1', url: page('v0.1.1') });
  });

  it('is nothing when this version is the newest, or newer, and never a draft', () => {
    assert.equal(newestRelease(releases, '0.2.0-beta.1', true), undefined);
    assert.equal(newestRelease(releases, '0.1.1', false), undefined);
    assert.equal(newestRelease(releases, '0.9.0', true), undefined);
    assert.equal(newestRelease([release('v0.3.0', { draft: true })], '0.1.0', true), undefined);
  });

  it('skips pre-releases by GitHub\'s flag or by their version when they are left out', () => {
    const list = [release('v0.2.0', { prerelease: true }), release('v0.1.5-rc.1', { prerelease: false }), release('v0.1.2')];
    assert.deepEqual(newestRelease(list, '0.1.0', false), { version: '0.1.2', url: page('v0.1.2') });
    assert.deepEqual(newestRelease(list, '0.1.0', true), { version: '0.2.0', url: page('v0.2.0') });
  });

  it('with only pre-releases published, is one only when they are included', () => {
    const alphas = [release('v0.1.0-alpha.3'), release('v0.1.0-alpha.2')];
    assert.equal(newestRelease(alphas, '0.1.0-alpha.2', false), undefined);
    assert.deepEqual(newestRelease(alphas, '0.1.0-alpha.2', true), { version: '0.1.0-alpha.3', url: page('v0.1.0-alpha.3') });
  });

  it('skips what doesn\'t read: odd tags, other sites\' links, anything but a list', () => {
    const odd = [
      release('nightly'),
      { tag_name: 'v9.0.0', html_url: 'https://evil.example/Breeze/ideablade-validation-editor/releases/tag/v9.0.0' },
      { tag_name: 'v8.0.0', html_url: 'https://github.com/someone-else/repo/releases/tag/v8.0.0' },
      null,
      { name: 'no tag' },
      release('v0.1.1'),
    ];
    assert.deepEqual(newestRelease(odd, '0.1.0', true), { version: '0.1.1', url: page('v0.1.1') });
    assert.equal(newestRelease({ message: 'API rate limit exceeded' }, '0.1.0', true), undefined);
  });
});

describe('release page links', () => {
  it('are the project\'s pages on github.com over https, nothing else', () => {
    assert.ok(isReleasePageUrl(page('v0.1.0')));
    assert.ok(isReleasePageUrl('https://github.com/Breeze/ideablade-validation-editor/releases'));
    assert.ok(!isReleasePageUrl('http://github.com/Breeze/ideablade-validation-editor/releases'));
    assert.ok(!isReleasePageUrl('https://github.com/Breeze/ideablade-validation-editor-fork/releases'));
    assert.ok(!isReleasePageUrl('https://github.com.evil.example/Breeze/ideablade-validation-editor/releases'));
    assert.ok(!isReleasePageUrl('https://user@github.com/Breeze/ideablade-validation-editor/releases'));
    assert.ok(!isReleasePageUrl('file:///C:/Windows/System32/calc.exe'));
    assert.ok(!isReleasePageUrl('not a url'));
  });
});
