import {
  createShortcuts,
  ShortcutManager,
  parseCombo,
  parseShortcut,
  normalizeCombo,
  normalizeShortcut,
} from '@lp-labs/shortcuts';
import type {
  Platform,
  ConflictPolicy,
  ParsedCombo,
  ParseOptions,
  ManagerOptions,
  RegistrationOptions,
  ShortcutContext,
  ShortcutHandler,
  ShortcutRegistration,
} from '@lp-labs/shortcuts';

const platform: Platform = 'mac';
const conflictPolicy: ConflictPolicy = 'error';
const parseOptions: ParseOptions = { platform };
const combo: ParsedCombo = parseCombo('Mod+K', parseOptions);
const options: ManagerOptions = { platform, conflictPolicy, target: new EventTarget() };
const manager: ShortcutManager = createShortcuts(options);
const registrationOptions: RegistrationOptions = { scope: 'editor', preventDefault: true };
const handler: ShortcutHandler = (context: ShortcutContext) => {
  const event: KeyboardEvent = context.event;
  event.preventDefault();
};
const handle: ShortcutRegistration = manager.register(
  combo.normalized,
  handler,
  registrationOptions,
);
manager.setScopes(['editor']).disable().enable().detach().attach(document);
handle.disable();
handle.enable();
handle.unregister();
manager.dispose();
normalizeCombo('K');
normalizeShortcut('G G');
parseShortcut('G G');
// @ts-expect-error platform must be explicit, not inferred
createShortcuts({ platform: 'auto' });
// @ts-expect-error registration flags are booleans
manager.register('K', handler, { preventDefault: 'yes' });
// @ts-expect-error parsed combos are immutable
combo.key = 'x';
