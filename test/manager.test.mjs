import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { ShortcutManager, createShortcuts } from '../dist/esm/index.js';
import { TrackedTarget, press, element, KeyEvent } from './helpers.mjs';

function setup(t, options = {}) {
  const target = new TrackedTarget();
  const manager = createShortcuts({ target, ...options });
  t.after(() => manager.dispose());
  return { target, manager };
}

test('construction without a target is inert; attach and detach are reusable', (t) => {
  const manager = new ShortcutManager();
  t.after(() => manager.dispose());
  const target = new TrackedTarget();
  let count = 0;
  manager.register('K', () => count++);
  press(target, 'k');
  assert.equal(count, 0);
  assert.equal(manager.target, undefined);
  assert.equal(manager.attach(target), manager);
  assert.equal(target.listeners.size, 4);
  assert.equal(manager.attach(target), manager);
  assert.equal(target.additions, 4);
  press(target, 'k');
  manager.detach().detach();
  assert.equal(target.listeners.size, 0);
  press(target, 'k');
  assert.equal(count, 1);
  manager.attach(target);
  press(target, 'k');
  assert.equal(count, 2);
});

test('context identifies the normalized registration and completing event', (t) => {
  const { target, manager } = setup(t);
  let context;
  const handle = manager.register('ctrl+k', (value) => {
    context = value;
  });
  const event = press(target, 'K', { ctrlKey: true });
  assert.deepEqual(context, { event, manager, id: handle.id, scope: 'global', shortcut: 'Ctrl+K' });
  assert.equal(handle.shortcut, 'Ctrl+K');
  assert.equal(handle.scope, 'global');
  assert.equal(Object.isFrozen(handle), true);
});

test('matching requires exact modifiers and explicit Shift even for uppercase letters', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('Ctrl+K', () => calls.push('ctrl'));
  manager.register('Shift+K', () => calls.push('shift'));
  press(target, 'k');
  press(target, 'k', { ctrlKey: true, altKey: true });
  press(target, 'K', { ctrlKey: true, shiftKey: true });
  press(target, 'K', { ctrlKey: true });
  press(target, 'K', { shiftKey: true });
  assert.deepEqual(calls, ['ctrl', 'shift']);
});

test('manager platform resolves Mod consistently for every step', (t) => {
  const { target, manager } = setup(t, { platform: 'mac' });
  let count = 0;
  const handle = manager.register('Mod+K Mod+C', () => count++);
  assert.equal(handle.shortcut, 'Meta+K Meta+C');
  press(target, 'k', { ctrlKey: true });
  press(target, 'c', { ctrlKey: true });
  assert.equal(count, 0);
  press(target, 'k', { metaKey: true });
  press(target, 'c', { metaKey: true });
  assert.equal(count, 1);
});

test('space, named, punctuation and function keys match KeyboardEvent.key', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  for (const shortcut of ['Space', 'Enter', 'ArrowUp', 'F12', 'Shift+Plus', '/']) {
    manager.register(shortcut, ({ shortcut: normalized }) => calls.push(normalized));
  }
  for (const key of [' ', 'Enter', 'ArrowUp', 'F12']) press(target, key);
  press(target, '+', { shiftKey: true });
  press(target, '/');
  assert.deepEqual(calls, ['Space', 'Enter', 'ArrowUp', 'F12', 'Shift+Plus', '/']);
});

test('last registered eligible duplicate wins by default, disabled winners reveal earlier ones', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G', () => calls.push('first'), { preventDefault: true });
  const last = manager.register('g', () => calls.push('last'));
  assert.equal(press(target, 'g').defaultPrevented, false);
  last.disable();
  assert.equal(last.enabled, false);
  assert.equal(press(target, 'g').defaultPrevented, true);
  last.enable();
  press(target, 'g');
  last.unregister();
  last.unregister();
  assert.equal(last.registered, false);
  assert.equal(last.enabled, false);
  assert.throws(() => last.enable(), /unregistered/);
  press(target, 'g');
  assert.deepEqual(calls, ['last', 'first', 'last', 'first']);
});

test('first-wins policy and eligibility select exactly one callback', (t) => {
  const { target, manager } = setup(t, { conflictPolicy: 'first-wins' });
  const calls = [];
  const first = manager.register('G', () => calls.push(1));
  manager.register('g', () => calls.push(2), { allowRepeat: true });
  press(target, 'g');
  press(target, 'g', { repeat: true });
  first.disable();
  press(target, 'g');
  assert.deepEqual(calls, [1, 2, 2]);
});

test('error conflict policy includes disabled entries, but not other scopes or prefix overlaps', (t) => {
  const { manager } = setup(t, { conflictPolicy: 'error', platform: 'mac' });
  const handle = manager.register('Mod+K', () => {}, { enabled: false });
  assert.throws(
    () => manager.register('Meta+k', () => {}),
    /already registered.*global.*Unregister/,
  );
  manager.register('Meta+K', () => {}, { scope: 'editor' });
  manager.register('Meta+K C', () => {});
  handle.unregister();
  assert.doesNotThrow(() => manager.register('Meta+K', () => {}));
});

test('scope precedence is rightmost active, above global, independent of registration order', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G', () => calls.push('dialog'), { scope: 'dialog' });
  manager.register('G', () => calls.push('editor'), { scope: 'editor' });
  manager.register('G', () => calls.push('global'));
  press(target, 'g');
  manager.setScopes(['editor', 'dialog']);
  press(target, 'g');
  manager.setScopes(['dialog', 'editor']);
  press(target, 'g');
  manager.setScopes([]);
  press(target, 'g');
  assert.deepEqual(calls, ['global', 'dialog', 'editor', 'global']);
  assert.equal(Object.isFrozen(manager.scopes), true);
});

test('higher-scope single beats lower-scope sequence and higher-scope prefix suppresses global', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G G', () => calls.push('global-sequence'));
  manager.register('G', () => calls.push('editor-single'), { scope: 'editor' });
  manager.register('X', () => calls.push('global-single'));
  manager.register('X X', () => calls.push('editor-sequence'), { scope: 'editor' });
  manager.setScopes(['editor']);
  press(target, 'g');
  press(target, 'x');
  assert.deepEqual(calls, ['editor-single']);
  press(target, 'x');
  assert.deepEqual(calls, ['editor-single', 'editor-sequence']);
});

test('editable tags, descendants, ARIA textboxes and shadow composed paths are ignored', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G', () => count++);
  const editableNodes = [
    element('INPUT'),
    element('textarea'),
    element('SELECT'),
    element('div', { contenteditable: '' }),
    element('div', { contenteditable: 'true' }),
    element('div', { contenteditable: 'plaintext-only' }),
    element('div', { role: 'textbox' }),
    { isContentEditable: true },
  ];
  for (const parent of editableNodes) {
    press(target, 'g', { target: parent });
    press(target, 'g', { target: element('span', {}, parent) });
    press(target, 'g', { target: element('div'), path: [element('span'), parent, target] });
  }
  assert.equal(count, 0);
  press(target, 'g', { target: element('button') });
  press(target, 'g', { target: element('div', { contenteditable: 'false' }) });
  assert.equal(count, 2);
  manager.register('G', () => count++, { allowInEditable: true });
  press(target, 'g', { target: editableNodes[0] });
  assert.equal(count, 3);
});

test('editable ancestor detection handles shadow hosts and cyclic synthetic ancestry', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G', () => count++);
  press(target, 'g', { target: { host: element('div', { contenteditable: 'true' }) }, path: [] });
  const cyclic = element('span');
  cyclic.parentNode = cyclic;
  press(target, 'g', { target: cyclic, path: [] });
  assert.equal(count, 1);
});

test('preventDefault and stopPropagation are opt-in and not stopImmediatePropagation', (t) => {
  const { target, manager } = setup(t);
  manager.register('G', () => {});
  const ordinary = press(target, 'g');
  assert.equal(ordinary.defaultPrevented, false);
  assert.equal(ordinary.stopped, false);
  manager.register('X', () => {}, { preventDefault: true, stopPropagation: true });
  let external = 0;
  target.addEventListener('keydown', () => external++);
  const optedIn = press(target, 'x');
  assert.equal(optedIn.defaultPrevented, true);
  assert.equal(optedIn.stopped, true);
  assert.equal(external, 1);
  assert.equal(press(target, 'x', { cancelable: false }).defaultPrevented, false);
});

test('defaultPrevented events do not run handlers', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G', () => count++);
  const event = new KeyEvent('g');
  event.preventDefault();
  target.dispatchEvent(event);
  assert.equal(count, 0);
});

test('repeats are ignored by default, explicitly permitted otherwise', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G', () => calls.push('g'));
  manager.register('X', () => calls.push('x'), { allowRepeat: true });
  press(target, 'g', { repeat: true });
  press(target, 'x', { repeat: true });
  assert.deepEqual(calls, ['x']);
});

test('composition flags, legacy 229, composition lifecycle and AltGraph are guarded', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G', () => count++, { allowInEditable: true, allowRepeat: true });
  manager.register('Ctrl+Alt+G', () => count++);
  press(target, 'g', { isComposing: true });
  press(target, 'g', { keyCode: 229 });
  press(target, 'g', { ctrlKey: true, altKey: true, altGraph: true });
  target.dispatchEvent(new Event('compositionstart'));
  press(target, 'g');
  target.dispatchEvent(new Event('compositionend'));
  press(target, 'g');
  target.dispatchEvent(new Event('compositionstart'));
  target.dispatchEvent(new Event('blur'));
  press(target, 'g');
  assert.equal(count, 2);
});

test('non-key events and unsupported/dead keys never invoke shortcuts', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G', () => count++);
  target.dispatchEvent(new Event('keydown'));
  for (const key of ['Dead', 'Unidentified', 'Process', 'Control']) press(target, key);
  assert.equal(count, 0);
});

test('manager and registration enable/disable preserve registrations', (t) => {
  const { target, manager } = setup(t, { enabled: false });
  let count = 0;
  const handle = manager.register('G', () => count++, { enabled: false });
  assert.equal(manager.enabled, false);
  press(target, 'g');
  handle.enable();
  press(target, 'g');
  manager.enable();
  press(target, 'g');
  manager.disable();
  press(target, 'g');
  manager.enable();
  handle.disable();
  press(target, 'g');
  assert.equal(count, 1);
  assert.equal(handle.registered, true);
});

test('reattachment removes old listeners and uses the same capture mode', (t) => {
  const { target, manager } = setup(t, { capture: true });
  const second = new TrackedTarget();
  let count = 0;
  manager.register('G', () => count++);
  manager.attach(second);
  assert.equal(target.listeners.size, 0);
  assert.equal(target.removals, 4);
  assert.equal(second.listeners.size, 4);
  for (const value of second.listeners.values()) assert.equal(value.capture, true);
  press(target, 'g');
  press(second, 'g');
  assert.equal(count, 1);
  manager.dispose();
  assert.equal(second.listeners.size, 0);
});

test('invalid attachment is rejected before detaching a valid target', (t) => {
  const { target, manager } = setup(t);
  assert.throws(() => manager.attach({}), /target must/);
  assert.equal(manager.target, target);
  assert.equal(target.listeners.size, 4);
});

test('partial attachment failures roll back installed listeners', (t) => {
  const manager = new ShortcutManager();
  t.after(() => manager.dispose());
  const target = new TrackedTarget();
  const add = target.addEventListener;
  target.addEventListener = function (type, listener, capture) {
    if (type === 'compositionend') throw new Error('installation failed');
    add.call(this, type, listener, capture);
  };
  assert.throws(() => manager.attach(target), /installation failed/);
  assert.equal(target.listeners.size, 0);
  assert.equal(manager.target, undefined);
});

test('dispose is idempotent and invalidates handles and further mutations', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  const handle = manager.register('G', () => count++);
  manager.dispose();
  manager.dispose();
  manager.detach();
  handle.unregister();
  assert.equal(manager.disposed, true);
  assert.equal(manager.enabled, false);
  assert.equal(manager.target, undefined);
  assert.equal(handle.registered, false);
  assert.equal(handle.enabled, false);
  assert.equal(target.listeners.size, 0);
  press(target, 'g');
  assert.equal(count, 0);
  for (const action of [
    () => manager.register('X', () => {}),
    () => manager.attach(target),
    () => manager.enable(),
    () => manager.disable(),
    () => manager.setScopes([]),
    () => handle.enable(),
    () => handle.disable(),
  ])
    assert.throws(action, /disposed/);
});

test('callbacks can unregister themselves, dispose or change scopes safely', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  const first = manager.register('G', () => {
    count++;
    first.unregister();
  });
  press(target, 'g');
  press(target, 'g');
  manager.register('X', () => manager.setScopes(['dialog']));
  manager.register(
    'Y',
    () => {
      count++;
      manager.dispose();
    },
    { scope: 'dialog' },
  );
  press(target, 'x');
  press(target, 'y');
  press(target, 'y');
  assert.equal(count, 2);
});

test('manager configuration errors are explicit, with no listeners installed', () => {
  for (const options of [null, [], false]) {
    assert.throws(() => createShortcuts(options), /options object/);
  }
  const target = new TrackedTarget();
  const cases = [
    [{ platform: 'auto' }, /platform must/],
    [{ platform: null }, /platform must/],
    [{ conflictPolicy: 'merge' }, /conflictPolicy must/],
    [{ conflictPolicy: null }, /conflictPolicy must/],
    [{ sequenceTimeout: 0 }, /sequenceTimeout must/],
    [{ sequenceTimeout: -1 }, /sequenceTimeout must/],
    [{ sequenceTimeout: 1.5 }, /sequenceTimeout must/],
    [{ sequenceTimeout: Infinity }, /sequenceTimeout must/],
    [{ sequenceTimeout: NaN }, /sequenceTimeout must/],
    [{ sequenceTimeout: 2147483648 }, /sequenceTimeout must/],
    [{ sequenceTimeout: null }, /sequenceTimeout must/],
    [{ sequenceTimeout: '1000' }, /sequenceTimeout must/],
    [{ capture: 1 }, /capture must be a boolean/],
    [{ enabled: null }, /enabled must be a boolean/],
    [{ typo: true }, /Unknown manager option/],
  ];
  for (const [options, error] of cases) {
    assert.throws(() => createShortcuts({ target, ...options }), error);
    assert.equal(target.additions, 0);
  }
  for (const invalid of [null, {}, 1, { addEventListener() {} }]) {
    assert.throws(() => createShortcuts({ target: invalid }), /target must/);
  }
});

test('registration and scope configuration validate atomically', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G', () => count++, { scope: 'editor' });
  manager.setScopes(['editor']);
  for (const options of [null, [], true]) {
    assert.throws(() => manager.register('G', () => {}, options), /options object/);
  }
  assert.throws(() => manager.register('G', null), /handler must be a function/);
  for (const scope of ['', ' with spaces', '1bad', null, 2]) {
    assert.throws(() => manager.register('G', () => {}, { scope }), /scope must/);
    assert.throws(() => manager.setScopes([scope]), /scope must/);
  }
  for (const key of [
    'enabled',
    'allowInEditable',
    'allowRepeat',
    'preventDefault',
    'stopPropagation',
  ]) {
    assert.throws(() => manager.register('G', () => {}, { [key]: 'true' }), /must be a boolean/);
  }
  assert.throws(
    () => manager.register('G', () => {}, { allowInput: true }),
    /Unknown registration option/,
  );
  assert.throws(() => manager.setScopes(null), /array/);
  assert.throws(() => manager.setScopes(['editor', 'editor']), /Duplicate active scope/);
  assert.throws(() => manager.setScopes(['global']), /always active/);
  assert.deepEqual(manager.scopes, ['editor']);
  press(target, 'g');
  assert.equal(count, 1);
});

test('sequence completes only after all steps and reports the final key event', (t) => {
  const { target, manager } = setup(t);
  let context;
  manager.register('G G H', (value) => {
    context = value;
  });
  press(target, 'g');
  press(target, 'g');
  assert.equal(context, undefined);
  const event = press(target, 'h');
  assert.equal(context.event, event);
  assert.equal(context.shortcut, 'G G H');
  press(target, 'h');
  assert.equal(context.event, event);
});

test('mismatched sequence retries the mismatching key as a new root', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G G', () => calls.push('gg'));
  manager.register('X Y', () => calls.push('xy'));
  press(target, 'g');
  press(target, 'x');
  press(target, 'y');
  assert.deepEqual(calls, ['xy']);
});

test('overlapping prefixes defer short match, longer completion discards fallback', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 20 });
  const calls = [];
  manager.register('G', () => calls.push('g'));
  manager.register('G G', () => calls.push('gg'));
  press(target, 'g');
  assert.deepEqual(calls, []);
  press(target, 'g');
  assert.deepEqual(calls, ['gg']);
  await delay(60);
  assert.deepEqual(calls, ['gg']);
});

test('timeout invokes the longest completed prefix using its original event', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 20 });
  const calls = [];
  manager.register('G', ({ event }) => calls.push(['g', event]));
  manager.register('G G', ({ event }) => calls.push(['gg', event]));
  manager.register('G G H', () => calls.push(['ggh']));
  press(target, 'g');
  const second = press(target, 'g');
  await delay(60);
  assert.deepEqual(calls, [['gg', second]]);
});

test('fallback is retained across additional partial steps; mismatch runs it before retry', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G', ({ event }) => calls.push(['g', event]));
  manager.register('G H I', () => calls.push(['ghi']));
  manager.register('X', () => calls.push(['x']));
  const first = press(target, 'g');
  press(target, 'h');
  press(target, 'x');
  assert.deepEqual(calls, [['g', first], ['x']]);
});

test('timeout without a completed prefix only resets progress', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 20 });
  let count = 0;
  manager.register('G H', () => count++);
  press(target, 'g');
  await delay(60);
  press(target, 'h');
  assert.equal(count, 0);
  press(target, 'g');
  press(target, 'h');
  assert.equal(count, 1);
});

test('timeout is renewed by each accepted sequence step', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 100 });
  let count = 0;
  manager.register('G H I', () => count++);
  press(target, 'g');
  await delay(30);
  press(target, 'h');
  await delay(80);
  press(target, 'i');
  assert.equal(count, 1);
});

test('sequence duplicates obey policy, and prefix effects use only duplicate winners', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G H', () => calls.push(1), { preventDefault: true });
  manager.register('G H', () => calls.push(2));
  assert.equal(press(target, 'g').defaultPrevented, false);
  assert.equal(press(target, 'h').defaultPrevented, false);
  assert.deepEqual(calls, [2]);
});

test('event effects on ambiguous prefixes are the union of distinct viable shortcuts', (t) => {
  const { target, manager } = setup(t);
  manager.register('G', () => {});
  manager.register('G H', () => {}, { preventDefault: true });
  manager.register('G I', () => {}, { stopPropagation: true });
  const prefix = press(target, 'g');
  assert.equal(prefix.defaultPrevented, true);
  assert.equal(prefix.stopped, true);
  const last = press(target, 'h');
  assert.equal(last.defaultPrevented, true);
  assert.equal(last.stopped, false);
});

test('modifier-only keydown and disallowed repeat preserve sequence progress', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G', () => calls.push('g'));
  manager.register('G Shift+H', () => calls.push('gh'));
  press(target, 'g');
  press(target, 'g', { repeat: true });
  press(target, 'Shift', { shiftKey: true });
  press(target, 'H', { shiftKey: true });
  assert.deepEqual(calls, ['gh']);
});

test('explicitly allowed repeated keys can complete a sequence', (t) => {
  const { target, manager } = setup(t);
  let count = 0;
  manager.register('G G', () => count++, { allowRepeat: true });
  press(target, 'g');
  press(target, 'g', { repeat: true });
  assert.equal(count, 1);
});

test('ignored events cancel pending sequence and fallback without invoking', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 20 });
  let count = 0;
  manager.register('G', () => count++);
  manager.register('G H', () => count++);
  const cancel = [
    () => press(target, 'Dead'),
    () => press(target, 'x', { isComposing: true }),
    () => press(target, 'x', { keyCode: 229 }),
    () => press(target, 'x', { altGraph: true }),
    () => press(target, 'AltGraph', { altGraph: true }),
    () => {
      const event = new KeyEvent('x');
      event.preventDefault();
      target.dispatchEvent(event);
    },
    () => press(target, 'x', { target: element('input') }),
    () => target.dispatchEvent(new Event('blur')),
    () => target.dispatchEvent(new Event('compositionstart')),
  ];
  for (const action of cancel) {
    press(target, 'g');
    action();
    target.dispatchEvent(new Event('compositionend'));
    await delay(35);
  }
  assert.equal(count, 0);
});

test('registration mutations, scopes and lifecycle changes cancel pending callbacks', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 15 });
  let count = 0;
  const handle = manager.register('G', () => count++);
  manager.register('G H', () => count++);
  const mutation = [
    () => manager.register('X', () => {}),
    () => {
      handle.disable();
      handle.enable();
    },
    () => manager.setScopes(['editor']),
    () => {
      manager.disable();
      manager.enable();
    },
    () => {
      manager.detach();
      manager.attach(target);
    },
    () => manager.attach(new TrackedTarget()),
    () => handle.unregister(),
  ];
  for (const action of mutation) {
    manager.attach(target);
    press(target, 'g');
    action();
    await delay(35);
  }
  assert.equal(count, 0);
});

test('disposal clears pending timeouts and all listeners', async (t) => {
  const { target, manager } = setup(t, { sequenceTimeout: 15 });
  let count = 0;
  manager.register('G', () => count++);
  manager.register('G H', () => count++);
  press(target, 'g');
  manager.dispose();
  await delay(40);
  assert.equal(count, 0);
  assert.equal(target.listeners.size, 0);
});

test('fallback callback disposal prevents mismatching key from being retried', (t) => {
  const { target, manager } = setup(t);
  const calls = [];
  manager.register('G', () => {
    calls.push('g');
    manager.dispose();
  });
  manager.register('G H', () => calls.push('gh'));
  manager.register('X', () => calls.push('x'));
  press(target, 'g');
  press(target, 'x');
  assert.deepEqual(calls, ['g']);
});
