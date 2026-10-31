import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as esm from '@lp-labs/shortcuts';

const require = createRequire(import.meta.url);
const cjs = require('@lp-labs/shortcuts');

test('ESM and CommonJS expose the same runtime API and behavior', () => {
  const expected = [
    'ShortcutManager',
    'createShortcuts',
    'normalizeCombo',
    'normalizeShortcut',
    'parseCombo',
    'parseShortcut',
  ];
  assert.deepEqual(Object.keys(esm).sort(), expected);
  assert.deepEqual(Object.keys(cjs).sort(), expected);
  assert.deepEqual(
    cjs.parseShortcut('Mod+K C', { platform: 'mac' }),
    esm.parseShortcut('Mod+K C', { platform: 'mac' }),
  );
  const target = new EventTarget();
  const manager = cjs.createShortcuts({ target });
  let count = 0;
  manager.register('K', () => count++);
  const event = new Event('keydown');
  Object.defineProperty(event, 'key', { value: 'k' });
  target.dispatchEvent(event);
  manager.dispose();
  target.dispatchEvent(event);
  assert.equal(count, 1);
});

test('both entry points import and construct without any DOM globals or global listeners', () => {
  const esmURL = new URL('../dist/esm/index.js', import.meta.url).href;
  const cjsPath = require.resolve('@lp-labs/shortcuts');
  const script = `
    const fail = () => { throw new Error("Unexpected browser global access"); };
    for (const name of ["window", "document", "navigator", "EventTarget", "KeyboardEvent"]) {
      Object.defineProperty(globalThis, name, { get: fail, configurable: true });
    }
    globalThis.addEventListener = fail;
    globalThis.setTimeout = fail;
    const esm = await import(${JSON.stringify(esmURL)});
    const { createRequire } = await import("node:module");
    const cjs = createRequire(import.meta.url)(${JSON.stringify(cjsPath)});
    for (const api of [esm, cjs]) {
      const manager = api.createShortcuts();
      const handle = manager.register("Mod+K", () => {});
      handle.unregister();
      manager.dispose();
      if (api.normalizeCombo("Mod+K") !== "Ctrl+K") throw new Error("Incorrect normalization");
    }
  `;
  execFileSync(process.execPath, ['--input-type=module', '--eval', script], { stdio: 'pipe' });
});

test('required metadata, private CJS scope and consumer author links agree', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.deepEqual(manifest.publishConfig, {
    access: 'public',
    registry: 'https://registry.npmjs.org/',
  });
  assert.deepEqual(manifest.funding, {
    type: 'paypal',
    url: 'https://www.paypal.me/LibinPrasanth',
  });
  assert.deepEqual(manifest.author, {
    name: 'Libin Prasanth',
    url: 'https://www.linkedin.com/in/libinprasanth/',
  });
  assert.ok(readme.includes(manifest.author.url));
  assert.ok(readme.includes(manifest.funding.url));
  assert.equal(manifest.name, '@lp-labs/shortcuts');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.peerDependencies, undefined);
  const cjsScope = JSON.parse(
    readFileSync(new URL('../dist/cjs/package.json', import.meta.url), 'utf8'),
  );
  assert.deepEqual(cjsScope, { type: 'commonjs' });
});
