---
name: comfyui-arch-review
description: >
  Architecture review gate for ComfyUI-Gallery changes. Invoke this skill BEFORE implementing any
  plan that touches: focus ownership, keyboard events, event listeners, CSS scope, z-index, DOM
  structure, Radix components, or modal/dialog behavior. Detects second-order conflicts caused by
  the shared-DOM ComfyUI embedding (no iframe isolation). Use it whenever a plan involves
  onMouseDown, addEventListener, tabIndex, focus/blur, Esc/arrow key handling, new CSS roots, new
  portals, new Radix Dialog/AlertDialog/Tooltip, z-index values, or inline style colors. If you are
  about to write "go implement", run this review first.
location: project
---

# ComfyUI-Gallery Architecture Review

This skill reviews a proposed plan or change against the architectural invariants of
ComfyUI-Gallery's shared-DOM embedding. There is no iframe — the gallery shares `document`,
`window`, and `body` with all of ComfyUI's frontend. Most bugs in this codebase come from
ignoring second-order effects in this shared context.

## How to use

1. Read the proposed plan or change description from the conversation
2. Work through each checklist category below
3. For every category that is **triggered**, reason through the chain effect explicitly
4. Output a structured review (format at the end of this file)

---

## Checklist Categories

### 1. Document / Window Event Listeners

**Triggers:** any mention of `addEventListener`, `removeEventListener`, `useEventListener` on
`document` or `window`, or a `keydown`/`keyup`/`mousedown`/`click` listener not attached to a
specific element.

**Chain effect:** Listeners on `document` or `window` fire for every interaction anywhere on the
page — including ComfyUI's canvas, menus, node editor, and all other custom nodes. There is no
isolation boundary.

**Required check:** Is the listener scoped to `#comfy-gallery-root` or `#comfy-gallery-yarl-root`
(or a child element)? If not, this is a NO-GO.

**Fix pattern:** Attach to the gallery root element (get it via `document.getElementById` or a
`ref`), not to `document`/`window`. Clean up in the `useEffect` return.

---

### 2. Focus Ownership Changes

**Triggers:** `onMouseDown={e => e.preventDefault()}`, `tabIndex`, `.focus()`, `.blur()`,
`autoFocus`, removing or adding `onMouseDown preventDefault` from interactive elements, changes
to which element holds keyboard focus after user interaction.

**Chain effect:** Focus ownership determines which element's native keyboard handlers are active.
yarl's keyboard handler (Esc, arrow keys, etc.) only fires when its container element has focus.
When MetadataPanel buttons hold focus, yarl's keyboard handler is inactive. When they don't,
yarl is active.

**Required check:** After this change, who holds focus? What keyboard handlers become active or
inactive as a result? Trace EVERY key that the newly-active element handles (not just the one
you care about).

**Critical dependency:** yarl handles Esc to close the lightbox. Radix Dialog (`useModalDismiss`
in `GalleryModal.tsx`) also has a document-level Esc handler. If focus changes make yarl active,
BOTH fire on the same Esc keypress → double close. Check that `useModalDismiss(disabled)` covers
the new focus state.

---

### 3. Esc Key Conflict

**Triggers:** any focus ownership change (see #2), changes to lightbox open/close logic, new
overlays or dialogs that sit above the gallery, changes to `useModalDismiss`.

**The conflict:** yarl adds a keydown listener to its container. Radix Dialog (`DismissableLayer`)
adds a keydown listener to `document`. Both listen for Escape independently. Without coordination,
one Esc press closes both.

**Required check:**
- When the new change is active, what is open? (lightbox? settings? custom dialog?)
- Is `useModalDismiss(disabled)` in `GalleryModal.tsx` conditioned to block Radix's Esc handler
  during that state?
- Current condition: `disabled: showSettings || lightboxOpen` — does the new state need a new
  term added?

---

### 4. Inert Boundary (yarl ↔ gallery root)

**Triggers:** adding interactive UI (buttons, inputs, dialogs, menus) that needs to work while
the lightbox is open; rendering new components inside `GalleryModal` or `GalleryGrid`; adding
anything inside `#comfy-gallery-root`.

**Chain effect:** When yarl opens, it calls `portal.handleEnter()` which marks all sibling
elements as `inert` — this includes `#comfy-gallery-root`. Everything inside `#comfy-gallery-root`
becomes non-interactive and non-focusable.

**Required check:** Does this UI need to be interactive while the lightbox is open?
- If yes → it must render inside `#comfy-gallery-yarl-root` (via `GalleryLightboxPlugin` or
  similar)
- If it only needs to work when lightbox is closed → `#comfy-gallery-root` is fine

---

### 5. Radix Portal Targets

**Triggers:** adding any Radix UI component that uses a portal: `Dialog`, `AlertDialog`, `Select`,
`Tooltip`, `DropdownMenu`, `Popover`, `HoverCard`, `ContextMenu`, `Sheet`, `Command`.

**Chain effect:** Radix portals default to `document.body`. This places them outside the CSS
scope (no dark mode, no Tailwind important scoping) and outside the gallery roots (which may be
`inert`).

**Required check:**
- Does this Radix component use `PortalContext` to target `#comfy-gallery-portals`?
- Is this component rendering inside `GalleryLightboxPlugin` (inside yarl)?
  - If yes: `#comfy-gallery-portals` is inside the `inert` `#comfy-gallery-root` → must use the
    `lbPortalContainer` PortalContext override inside `#comfy-gallery-yarl-root` instead
  - Never fall back to `document.body` — wrap in a null guard instead

---

### 6. CSS Scope and Styling

**Triggers:** adding CSS rules, Tailwind classes, inline `style={}`, new CSS files, new CSS
custom properties, z-index values.

**Checks:**

**Inline colors:** Inline `style={{ color: ..., background: ... }}` with hardcoded `rgba()` or
hex values never respond to the `.dark` class toggle. Flag any hardcoded color in `style={}`.
Fix: use CSS-var-backed Tailwind classes (`bg-card`, `text-foreground`, `bg-muted`, etc.).

**Z-index:** Numeric z-index values (e.g., `style={{ zIndex: 50 }}` or `z-[50]`) break the
gallery-wide stacking order. Fix: use `--cg-z-*` CSS custom properties defined in `globals.css`.

**CSS scope:** Any new CSS rule must be scoped to `:is(#comfy-gallery-root, #comfy-gallery-yarl-root)`.
Unlayered CSS from ComfyUI beats any layered CSS including Tailwind utilities.

---

### 7. New DOM Roots or Mount Points

**Triggers:** creating new `ReactDOM.createRoot()` targets, new `createPortal` containers, new
top-level DOM elements appended to `body`.

**Chain effect:** New roots outside the known gallery roots won't have:
- Tailwind important scoping (`important: ':is(#comfy-gallery-root, #comfy-gallery-yarl-root)'`)
- Dark mode (`.dark` class toggled on the gallery roots)
- CSS variable inheritance
- Correct z-index context

**Required check:** Does the new root need to be added to the Tailwind important selector in
`tailwind.config.js`? To the CSS scope selectors in `globals.css`? Does `.dark` need to be
toggled on it in sync with the other roots?

---

## Output Format

Always produce a review in this exact structure:

```
## ComfyUI Architecture Review

### Triggered categories
[List each category number + name that applies to this change. If none, say "None — safe to proceed."]

### Findings
[For each triggered category:]
**[Category name]** — [ISSUE / WARN / OK]
[One paragraph: what the specific conflict is, why it matters, concrete fix if needed]

### Verdict
GO / CONDITIONAL GO / NO-GO

[If CONDITIONAL GO or NO-GO: numbered list of required changes before implementing]
```

- **GO**: no issues found in triggered categories
- **CONDITIONAL GO**: issues found but each has a clear fix; list them
- **NO-GO**: a conflict exists with no safe fix in the current approach; the plan needs
  rethinking before any implementation begins
