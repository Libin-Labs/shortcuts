import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCombo, parseShortcut, normalizeCombo, normalizeShortcut } from '../dist/esm/index.js';

test('normalizes keys, modifier order and sequence whitespace', () => {
  assert.equal(normalizeCombo(' meta+shift+alt+ctrl+k '), 'Ctrl+Alt+Shift+Meta+K');
  assert.equal(normalizeShortcut('  mod+k \n ctrl+enter\tg '), 'Ctrl+K Ctrl+Enter G');
  assert.equal(normalizeCombo('arrowdown'), 'ArrowDown');
  assert.equal(normalizeCombo('f24'), 'F24');
  assert.equal(normalizeCombo('space'), 'Space');
  assert.equal(normalizeCombo('Shift+Plus'), 'Shift+Plus');
  assert.equal(normalizeCombo('/'), '/');
  assert.deepEqual(parseCombo('Ctrl+A'), {
    key: 'a',
    ctrl: true,
    alt: false,
    shift: false,
    meta: false,
    normalized: 'Ctrl+A',
  });
});

test('Mod resolves only from the injected platform', () => {
  for (const platform of ['windows', 'linux', 'other']) {
    assert.equal(normalizeCombo('Mod+k', { platform }), 'Ctrl+K');
  }
  assert.equal(normalizeCombo('Mod+K', { platform: 'mac' }), 'Meta+K');
  assert.equal(normalizeShortcut('Mod+K Mod+C', { platform: 'mac' }), 'Meta+K Meta+C');
  assert.equal(normalizeCombo('Meta+K', { platform: 'windows' }), 'Meta+K');
});

test('parsed results are frozen snapshots', () => {
  const parsed = parseShortcut('G G');
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed[0]), true);
  assert.throws(() => {
    parsed[0].key = 'x';
  }, TypeError);
});

test('malformed combos have explicit actionable errors', () => {
  const cases = [
    ['', /non-empty/],
    [' ', /non-empty/],
    [null, /non-empty/],
    [123, /non-empty/],
    ['Ctrl', /non-modifier/],
    ['Mod', /non-modifier/],
    ['Ctrl++K', /Empty token.*Plus/],
    ['+', /Plus/],
    ['A+B', /exactly one/],
    ['Ctrl+Ctrl+K', /Duplicate modifier/],
    ['Mod+Ctrl+K', /Duplicate modifier/],
    ['ctrl + k', /whitespace/],
    ['Esc', /Unsupported key/],
    ['Command+K', /Unsupported key/],
    ['Control+K', /Unsupported key/],
    ['F25', /Unsupported key/],
    ['Dead', /Unsupported key/],
    ['e\u0301', /Unsupported key/],
  ];
  for (const [input, error] of cases) assert.throws(() => parseCombo(input), error, String(input));
  assert.throws(() => parseCombo('Mod+Meta+K', { platform: 'mac' }), /Duplicate modifier/);
  for (const input of ['', '  ', null, []]) assert.throws(() => parseShortcut(input), /non-empty/);
  assert.throws(() => parseShortcut('G Ctrl++K'), /Empty token/);
});

test('parsing options reject invalid objects, platforms and typos', () => {
  for (const options of [null, [], false]) {
    assert.throws(() => parseCombo('G', options), /options object/);
  }
  for (const platform of ['auto', 'MAC', null, 1]) {
    assert.throws(() => parseShortcut('G', { platform }), /platform must/);
  }
  assert.throws(() => parseCombo('G', { platfrom: 'mac' }), /Unknown parsing option/);
});
