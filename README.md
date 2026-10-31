# @lp-labs/shortcuts

An original, framework-neutral keyboard shortcut manager with exact key matching,
explicit platform configuration, scopes, and timed multi-step sequences.
Version 0.1.0 has zero runtime dependencies. No React, DOM shim, or shared
component package is required.

## Installation

```sh
npm install @lp-labs/shortcuts
```

```js
import { createShortcuts, normalizeShortcut } from "@lp-labs/shortcuts";

const shortcuts = createShortcuts({ target: document, platform: "mac" });
const save = shortcuts.register("Mod+S", ({ event, shortcut }) => {
  console.log("Save requested", shortcut, event.key);
}, { preventDefault: true, allowInEditable: true });

console.log(normalizeShortcut("mod+k mod+c", { platform: "mac" }));
// Meta+K Meta+C

save.disable();
save.enable();
save.unregister();
shortcuts.dispose();
```

CommonJS is also supported:

```js
const { createShortcuts, parseCombo } = require("@lp-labs/shortcuts");
const shortcuts = createShortcuts({ platform: "windows" });
console.log(parseCombo("Mod+K").normalized); // Ctrl+K
shortcuts.dispose();
```

Each export condition includes its own TypeScript declarations. Public types use
standard DOM types (`EventTarget`, `KeyboardEvent`); TypeScript consumers need
the `DOM` library in addition to an ES2022-compatible library. No `@types/node`
is needed to consume this package.

## Key grammar and normalization

- One combo has exactly one non-modifier key and zero or more modifiers, joined
  by `+`, for example `Ctrl+Shift+K`. Token names are case-insensitive.
- Modifiers: `Ctrl`, `Alt`, `Shift`, `Meta`, `Mod`. No `Cmd`, `Command`,
  `Control`, `Option`, or other aliases.
- `Mod` resolves to `Meta` for `platform: "mac"` and `Ctrl` for `"windows"`,
  `"linux"`, or `"other"`. The default is `"other"`. Configure the platform
  from your application's settings or environment; the package never reads
  `navigator`, detects an OS, or installs a listener during import.
- Supported keys: a single printable ASCII character, or `Enter`, `Escape`,
  `Tab`, `Space`, `Backspace`, `Delete`, `Insert`, `ArrowUp`, `ArrowDown`,
  `ArrowLeft`, `ArrowRight`, `Home`, `End`, `PageUp`, `PageDown`, `F1` through
  `F24`. Use `Plus` for `+` and `Space` for a literal space. There is no `Esc`
  alias. Modifier-only shortcuts are not supported.
- Separate sequence steps with whitespace: `G G`, `Mod+K Mod+C`. Surrounding
  whitespace is trimmed. Whitespace inside a combo, such as `Ctrl + K`, is
  invalid. Sequence whitespace is collapsed when normalized.
- Normalized modifier order is `Ctrl+Alt+Shift+Meta`, followed by the key.
  Letter display names are uppercase; parsed `key` values are lowercase.
  Parsed space is `"space"` and parsed plus is `"+"`.
- All four modifiers must match exactly. `Ctrl+K` will not match
  `Ctrl+Shift+K`. Uppercase spelling does **not** imply Shift: register
  `Shift+K` to require it. A keyboard that produces `+` with Shift requires
  `Shift+Plus`, not `Plus`.
- Matching uses `KeyboardEvent.key`, not `code`, and therefore follows the
  user's layout. Unsupported or dead keys cancel pending progress.
  Non-ASCII characters, physical-key bindings, and key-up shortcuts are not
  supported in this version.
- Repeating a modifier, including after resolving `Mod`, is an error.
  `Mod+Ctrl+K` is invalid on non-Mac platforms but valid on Mac.

```ts
import {
  parseCombo, normalizeCombo, parseShortcut, normalizeShortcut
} from "@lp-labs/shortcuts";

parseCombo("Shift+Mod+K", { platform: "mac" });
// Frozen:
// { key: "k", ctrl: false, alt: false, shift: true, meta: true,
//   normalized: "Shift+Meta+K" }

normalizeCombo("alt+ctrl+enter"); // "Ctrl+Alt+Enter"
parseShortcut("G G"); // Frozen array of frozen ParsedCombo objects
normalizeShortcut(" mod+k   mod+c "); // "Ctrl+K Ctrl+C"
```

All four helpers take an optional `{ platform?: Platform }`. `parseCombo`
returns `ParsedCombo`; `parseShortcut` returns `readonly ParsedCombo[]`.
The normalization helpers return a string. Parsing has no listeners or timers.

## API

Named runtime exports:

```ts
createShortcuts(options?: ManagerOptions): ShortcutManager
new ShortcutManager(options?: ManagerOptions)
parseCombo(input: string, options?: ParseOptions): ParsedCombo
parseShortcut(input: string, options?: ParseOptions): readonly ParsedCombo[]
normalizeCombo(input: string, options?: ParseOptions): string
normalizeShortcut(input: string, options?: ParseOptions): string
```

Named type exports: `Platform`, `ParseOptions`, `ParsedCombo`, `ConflictPolicy`,
`ManagerOptions`, `RegistrationOptions`, `ShortcutContext`, `ShortcutHandler`,
and `ShortcutRegistration`.

`ParsedCombo` contains readonly `key: string`, `ctrl: boolean`, `alt: boolean`,
`shift: boolean`, `meta: boolean`, and `normalized: string`. `ParseOptions`
contains only optional readonly `platform: Platform`. `ShortcutContext` contains
readonly `event: KeyboardEvent`, `shortcut: string`, `scope: string`,
`id: number`, and `manager: ShortcutManager`. `ShortcutRegistration` uses the
same numeric ID and string shortcut/scope, plus boolean enabled/registered
getters and the three void methods below. All option interfaces use readonly
optional fields; omitted flags use the defaults in their tables.

### Manager options

| Option | Default | Meaning |
| --- | --- | --- |
| `target?: EventTarget` | None | Attach immediately to this object only. A `Document`, `HTMLElement`, or injected `EventTarget` is accepted. |
| `platform?: Platform` | `"other"` | `"mac"`, `"windows"`, `"linux"`, or `"other"`. Fixed for the manager's lifetime. |
| `sequenceTimeout?: number` | `1000` | Idle time in milliseconds after each accepted prefix step. Integer from 1 to 2147483647. |
| `conflictPolicy?: ConflictPolicy` | `"last-wins"` | `"last-wins"`, `"first-wins"`, or `"error"` for identical normalized shortcuts in one scope. |
| `capture?: boolean` | `false` | Capture option for all installed listeners. Fixed for this manager. |
| `enabled?: boolean` | `true` | Whether keydown processing is enabled. |

There are no listeners until a target is explicitly supplied or attached.
The package can be imported, parsed, and constructed without a target in SSR
or Node. No default `document` or `window` is accessed.

### Registration

```ts
const registration = shortcuts.register(
  "Mod+K Mod+C",
  ({ event, shortcut, scope, id, manager }) => {
    // event: the completing KeyboardEvent, or the stored prefix event on fallback
    // shortcut: the resolved, normalized full registration string
    // scope: the registration's scope
    // id: unique, increasing within this manager
    // manager: this ShortcutManager
  },
  { scope: "editor", preventDefault: true }
);
```

`ShortcutHandler` is `(context: ShortcutContext) => void`. Callbacks run
synchronously on completion, mismatch fallback, or timeout fallback. There is
no asynchronous handler scheduling, return-value convention, or awaiting.
Exceptions are not swallowed; event-handler errors follow the host's event
error reporting and timeout-handler errors follow its timer error reporting.
Sequence state is cleared before a callback, allowing safe reentrant lifecycle
changes.

| Registration option | Default | Meaning |
| --- | --- | --- |
| `scope?: string` | `"global"` | Case-sensitive name matching `[A-Za-z][A-Za-z0-9._:-]*`. |
| `enabled?: boolean` | `true` | Initial registration state. |
| `allowInEditable?: boolean` | `false` | Permit keys originating in editable controls or their descendants. |
| `allowRepeat?: boolean` | `false` | Permit `event.repeat` at each step. |
| `preventDefault?: boolean` | `false` | Call `preventDefault()` immediately on each accepted step. |
| `stopPropagation?: boolean` | `false` | Call `stopPropagation()` immediately on each accepted step. |

Returned handles have readonly `id`, `shortcut`, `scope`, `enabled`, and
`registered` properties, plus:

- `enable(): void` / `disable(): void`: change eligibility, without changing
  registration order. Throw if unregistered or the manager is disposed.
- `unregister(): void`: remove this registration; repeated calls are safe,
  including after disposal. The handle then reports both flags as `false`.

Registration flags, normalized keys, platform, and scope are not mutable.
Unregister and register a new shortcut to replace its configuration.

### Scopes and conflicts

```js
shortcuts.register("Escape", () => closeDialog(), { scope: "dialog" });
shortcuts.register("Mod+Enter", () => submitEditor(), {
  scope: "editor",
  allowInEditable: true,
  preventDefault: true
});
shortcuts.setScopes(["editor", "dialog"]); // dialog > editor > global
shortcuts.setScopes(["editor"]); // editor > global
shortcuts.setScopes([]); // global only
```

The global scope is always active and lowest priority. Additional active scope
names are ordered from lowest to highest priority. Only the highest scope with
an eligible matching first step participates in a shortcut attempt. Higher
scope singles beat lower scope sequences; higher scope prefixes suppress
lower scope singles. Inactive scopes do not match. Eligibility includes enabled,
editable, and repeat rules, so an ineligible higher scope does not block a lower
one. Scopes are application state, not inferred from focus or DOM containment.
They are not a security boundary.

Within that scope, identical normalized full shortcuts select the first or
last **eligible** registration by insertion order. Exactly one duplicate
callback is chosen; disabled or unregistered entries do not participate. `"error"`
instead rejects a duplicate at registration time, even if an existing entry is
disabled. The same shortcut in a different scope is not a conflict. Prefix
overlaps such as `G` and `G G` are allowed under every policy.

`setScopes` requires an array of unique names. Omit `"global"` because it is
implicit. Unknown but syntactically valid scope names are allowed. The manager
copies and freezes the array; `manager.scopes` returns that snapshot without the
implicit global scope.

### Sequence timing and fallback

1. A unique complete match with no longer candidate invokes immediately.
2. A prefix waits for another step. If a shorter registration also completed,
   it is saved as a fallback instead of firing immediately.
3. Each accepted next step restarts the idle timeout. The longest completed
   prefix becomes the fallback. Longer completion discards earlier fallbacks.
4. Timeout invokes the fallback once, using its original completing event.
   If no complete prefix exists, it only clears progress.
5. A mismatching supported key invokes the saved fallback, if still eligible
   for that key's editable/repeat context, then retries the mismatching key
   once as a new first step. Intermediate consumed steps are not replayed.
   If the fallback disposes, disables, or changes the attached target, retry
   is canceled.
6. Only the candidates retained by the current attempt can continue. Another
   scope does not take over mid-sequence. Registration or scope mutations clear
   the attempt rather than changing it underneath the user.

Example: with `G`, `G H I`, and `X`, pressing `G H X` calls `G`, then `X`.
Pressing only `G` calls `G` after the timeout. Pressing `G H I` calls only
`G H I`. The timeout is idle time, not a limit on the total sequence duration.

On an ambiguous accepted step, event effects are the union of the options on
distinct viable shortcuts, after choosing one eligible winner per duplicate.
Thus `preventDefault` on `G H` can prevent the initial `G` even if `G I`
eventually wins or no sequence completes. Defaults are never prevented
retroactively at timeout. A completed prefix's propagation option only affects
its own completing step. Use `preventDefault` deliberately for text-like keys.

### Input guards

- Keys with `defaultPrevented` are ignored and cancel pending progress.
- `isComposing`, legacy `keyCode === 229`, a preceding `compositionstart`,
  and `AltGraph` reported by `getModifierState` block shortcuts and clear
  progress. `compositionend` or target `blur` clears composition state.
  These guards cannot be overridden by registration options.
- Modifier/lock-only keydown events preserve progress without restarting the
  timer. A repeat is ignored without restarting the timer when no pending
  candidate allows repeats. Allowed repeats can advance a sequence.
- Editable detection checks `input` (all types), `textarea`, `select`,
  `isContentEditable`, `contenteditable` values `""`, `"true"` or
  `"plaintext-only"`, and ARIA `role="textbox"`. It checks the composed path
  and target ancestry, including exposed shadow hosts. It intentionally ignores
  the entire editable subtree, including readonly inputs and nested
  `contenteditable="false"` islands inside an editable ancestor.
- Editable keys cannot continue a registration unless it opts in. A mismatched
  editable key cannot fire a non-opted-in fallback; it can still start a
  different opted-in registration.

### Lifecycle

| Member | Result |
| --- | --- |
| `attach(target): this` | Validate the target, detach the old one, attach `keydown`, `compositionstart`, `compositionend`, and `blur`. Same target is a no-op. |
| `detach(): this` | Remove listeners and cancel timers/progress. Keep registrations. Safe repeatedly, including after disposal. |
| `enable(): this` | Enable processing and clear progress. |
| `disable(): this` | Disable processing and clear progress. Listeners remain attached. |
| `setScopes(names): this` | Replace additional active scopes and clear progress. |
| `register(shortcut, handler, options?): ShortcutRegistration` | Validate and add a registration; clear progress. |
| `dispose(): void` | Detach, clear timers, invalidate all handles, drop handlers, and permanently disable. Idempotent. |
| `enabled`, `disposed`, `target`, `scopes` | Readonly state getters. Detached `target` is `undefined`. |

Registration enable/disable/unregister, manager enable/disable, scope changes,
reattachment, detachment, and disposal cancel pending sequence fallbacks.
Target `blur`, composition lifecycle events, default-prevented keys, AltGraph,
and unsupported keys also clear pending progress. Focus transitions are not
otherwise tracked: call `setScopes`, `disable`, or `detach` when navigating or
changing application context. A document listener does not automatically observe
window blur; connect your own window lifecycle handler if needed.

Always dispose on component unmount, page teardown, or when replacing a manager.
Never construct managers during rendering. Disabling does not unregister
handlers or remove listeners; use disposal for final cleanup.

### Errors

Invalid inputs throw `TypeError` synchronously, with messages naming the invalid
option, key, scope, or grammar rule. Examples include empty/non-string shortcuts,
unknown keys/modifiers, multiple keys in one combo, duplicate resolved modifiers,
invalid platforms/policies, non-boolean flags, invalid timeouts, invalid target
objects, duplicate active scopes, and unknown option names. Options must be
non-null objects, not arrays; omitted/`undefined` options use defaults, not `null`.

A duplicate under conflict policy `"error"` throws `Error` naming the normalized
shortcut and scope. Operations on a disposed manager throw `Error` except the
safe cleanup operations `dispose`, `detach`, and handle `unregister`. Enabling
or disabling an unregistered handle also throws `Error`. Failed configuration
validation does not change existing registrations/scopes/listeners. An invalid
attachment target leaves the current attachment intact. If a target itself
throws during listener installation, already installed listeners are removed
and the manager remains detached; host listener exceptions are not hidden.

## Complete browser example

Use the following HTML with a module entry resolved by your application's
bundler. Set the platform from your application configuration; this example
uses `"windows"` explicitly. No runtime OS guessing is necessary.

```html
<main>
  <h1>Notes</h1>
  <p>Save: Ctrl+S. Help: G, then H. Submit in editor: Ctrl+Enter.</p>
  <section id="editor" aria-label="Note editor">
    <label for="note">Note</label>
    <textarea id="note"></textarea>
    <button id="submit" type="button" aria-keyshortcuts="Control+Enter">Submit</button>
  </section>
  <button id="save" type="button" aria-keyshortcuts="Control+s">Save</button>
  <button id="help" type="button">Help</button>
  <output id="status" aria-live="polite"></output>
  <dialog id="help-dialog" aria-labelledby="help-title">
    <h2 id="help-title">Keyboard help</h2>
    <p>G then H opens this help. Escape closes it.</p>
    <button id="close-help" type="button">Close</button>
  </dialog>
</main>
```

```js
import { createShortcuts } from "@lp-labs/shortcuts";

const editor = document.querySelector("#editor");
const dialog = document.querySelector("#help-dialog");
const status = document.querySelector("#status");
const shortcuts = createShortcuts({
  target: document,
  platform: "windows",
  sequenceTimeout: 800
});

function refreshScopes() {
  const active = editor.contains(document.activeElement) ? ["editor"] : [];
  if (dialog.open) active.push("dialog");
  shortcuts.setScopes(active);
}
function save() { status.textContent = "Saved"; }
function submit() { status.textContent = "Submitted"; }
function openHelp() {
  if (!dialog.open) dialog.showModal();
  refreshScopes();
}
function closeHelp() { dialog.close(); }

shortcuts.register("Mod+S", save, {
  allowInEditable: true,
  preventDefault: true
});
shortcuts.register("Mod+Enter", submit, {
  scope: "editor",
  allowInEditable: true,
  preventDefault: true
});
shortcuts.register("G H", openHelp);
shortcuts.register("Escape", closeHelp, {
  scope: "dialog",
  allowInEditable: true,
  preventDefault: true
});

document.querySelector("#save").addEventListener("click", save);
document.querySelector("#submit").addEventListener("click", submit);
document.querySelector("#help").addEventListener("click", openHelp);
document.querySelector("#close-help").addEventListener("click", closeHelp);
document.addEventListener("focusin", refreshScopes);
dialog.addEventListener("close", refreshScopes);
refreshScopes();

// Invoke when this view is permanently removed.
export function destroy() {
  shortcuts.dispose();
  document.removeEventListener("focusin", refreshScopes);
  dialog.removeEventListener("close", refreshScopes);
  document.querySelector("#save").removeEventListener("click", save);
  document.querySelector("#submit").removeEventListener("click", submit);
  document.querySelector("#help").removeEventListener("click", openHelp);
  document.querySelector("#close-help").removeEventListener("click", closeHelp);
}
```

For element-local bindings, pass the focusable container as `target` instead of
`document`. Keyboard events must reach that container; attaching does not focus
it, alter `tabindex`, trap focus, or make it interactive.

## Optional React integration

React is not a dependency, peer dependency, or runtime import of this package.
If your application already uses React, create the manager inside an effect,
not at module scope or during rendering. This example cleans up correctly
when effects rerun, including React Strict Mode effect replay.

```tsx
import { useEffect } from "react";
import { createShortcuts } from "@lp-labs/shortcuts";
import type { Platform } from "@lp-labs/shortcuts";

export function SaveButton({
  platform,
  onSave
}: {
  platform: Platform;
  onSave: () => void;
}) {
  useEffect(() => {
    const shortcuts = createShortcuts({ target: document, platform });
    shortcuts.register("Mod+S", () => onSave(), {
      preventDefault: true,
      allowInEditable: true
    });
    return () => shortcuts.dispose();
  }, [platform, onSave]);

  const ariaShortcut = platform === "mac" ? "Meta+s" : "Control+s";
  return (
    <button type="button" onClick={onSave} aria-keyshortcuts={ariaShortcut}>
      Save
    </button>
  );
}
```

For multiple widgets sharing a document, prefer a single application manager
with explicit scopes. Separate managers are independent; their registration
order does not coordinate conflicts. A manager receiving an already prevented
event skips it. `stopPropagation` does not stop other listeners on the same
target and never calls `stopImmediatePropagation`.

## Customization, accessibility, and limits

- Let users remap or disable shortcuts, particularly unmodified letters and
  sequences. Expose ordinary buttons/menu items for every keyboard action.
- Scopes do not automatically isolate a modal. Disable background registrations
  or use a separate manager/application policy where modal behavior requires
  it; unmatched dialog shortcuts can still fall through to active lower scopes.
- Avoid overriding browser, OS, assistive-technology, and text-editing commands.
  Many reserved combinations never reach JavaScript, and some cannot be
  canceled. `preventDefault` only works for cancelable events.
- Set `aria-keyshortcuts` on the actual interactive control with resolved ARIA
  modifier names (for example `Control+s` or `Meta+s`), not `Mod`.
  ARIA has no equivalent here for ordered multi-step sequences; describe those
  in visible help. This manager does not add ARIA, focus management, live
  announcements, or a help UI.
- Editable filtering is conservative, not a complete detector for custom rich
  editors. Opt in deliberately, or scope/disable registrations yourself.
  Closed shadow roots can hide their internal editable targets.
- `KeyboardEvent.key` is layout-dependent. AltGraph and known composition
  signals are guarded, but there is no guarantee for every IME, virtual
  keyboard, assistive device, or browser-specific event stream.
- Targets must implement standard event listener semantics. Structural target
  validation does not certify arbitrary custom event implementations.
- Registrations have no hard count/sequence-length cap. Matching scans
  registrations/candidates and editable ancestry on keydown; long sequences and
  many handlers retain memory and can delay input. There is no indexed dispatch,
  worker offloading, or input-latency guarantee. Keep registrations scoped and
  dispose obsolete managers.
- Sequence timers use the host's `setTimeout`: background-tab throttling,
  suspension, and main-thread blocking can delay fallback delivery. A pending
  timer in Node can keep the process alive until it expires; dispose to cancel.
- The package targets modern browsers supporting ES2022 private fields,
  `EventTarget`, and modern keyboard events (current Chrome, Edge, Firefox, and
  Safari). No IE support or polyfills. Node 18+ supports import/parsing and
  injected event-target use, but has no native browser keyboard events.
- Unit tests use Node's `EventTarget` and synthetic keyboard mocks, not a real
  browser or jsdom. Browser/OS/IME and assistive-technology behavior must be
  tested in your own supported environments.

This is an original independent implementation, not a certification of legal
compliance, accessibility, production suitability, or compatibility with another
shortcut library. It is provided under the MIT license without warranty.

## License

[MIT](./LICENSE).

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.
