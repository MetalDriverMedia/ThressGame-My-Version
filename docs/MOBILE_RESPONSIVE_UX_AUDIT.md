# Mobile / Responsive UX Audit (Phase D, Narrow)

## Scope

This audit is frontend-first and intentionally narrow.

- Goal: keep core gameplay surfaces readable and usable across narrow viewports.
- Non-goals: gameplay rules, mutator semantics, move legality, room lifecycle, turn clock lifecycle, bot behavior, Socket.IO event names/payload shapes.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/BOARD_MARKERS_AUDIT.md`
- `docs/ACTIVE_MUTATOR_DISPLAY_AUDIT.md`
- `docs/EVENT_FEED_AUDIT.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`
- `public/js/ui.js`
- `public/js/socketHandlers.js`
- `public/js/main.js`
- `public/js/state.js`
- `public/js/mutatorUI.js`
- `public/js/board.js`
- `public/index.html`
- `public/styles.css`

## Responsive UX inventory

| Surface | Current behavior | Risk | Recommended treatment | Timing |
|---|---|---|---|---|
| Board scaling | Board stacks above choice panel at `<=1024px`; board keeps square aspect ratio | Medium on small landscape due to constrained vertical space and dense neighboring surfaces | Keep board full-width of game column on narrow screens, trim surrounding panel padding, avoid additional fixed-height constraints | **Now** |
| Prompts visibility | Target selection bar appears below board; choice panel can grow tall | Medium: prompt/status can be pushed below fold on mobile | Keep prompt bar full-width with compact typography; cap choice panel height and allow internal scroll | **Now** |
| Touch target selection | Board squares are button elements and selectable | Low-medium: surrounding overflow/crowding can reduce practical tap confidence | Preserve square buttons; reduce nearby crowding and ensure action/prompt bars do not collapse awkwardly | **Now (layout assist only)** |
| Room code sharing (waiting + in-game info bar) | Room code has copy/toggle controls and compact row layout | Medium on portrait: wrapping can clip or crowd controls | Allow room-code rows to wrap with taller touch targets in narrow widths | **Now** |
| Action modals (RPS/coin/game over) | Centered modal with fixed interior sizing tendencies | Medium-high on portrait: modal content can exceed viewport and hide board context entirely | On small widths, top-align modal container, cap modal height to viewport, enable modal body scrolling | **Now** |
| Spectator/mobile readability | Spectator badge/count and info bar visible | Medium on narrow widths due to dense one-line info bar | Allow info bar groups to wrap with tighter spacing | **Now** |
| Active mutator row usability | Bottom row wraps cards | Medium on portrait when cards stay wide | Make active mutator cards full-width on very narrow screens for readable stacked list | **Now** |
| Board overlays legibility | Marker overlays/icons are already present | Medium-low: icon density can visually compete on small boards | Keep current overlays; defer marker legend/priority layering to later PR | Later |
| History/event surfaces vs gameplay | Mutator/event surfaces can take vertical space when active | Medium on tablet/landscape due to vertical contention | Keep current surfaces; bound choice panel height on narrow viewports to reduce gameplay displacement | **Now** |
| Landing/create/join flow | Buttons/fields exist and mostly wrap | Medium on narrow portrait for join/create rows | Stack join/create rows and make key CTA fields/buttons full width on mobile | **Now** |

## Safe frontend fixes included

Implemented **CSS/layout-only** changes:

1. Improved narrow tablet and mobile game layout resilience:
   - Reduced game section gap, removed fixed right-column height at narrow breakpoints.
   - Added narrow breakpoint (`<=820px`) to remove main zoom and trim game panel padding.
2. Improved prompt/action surface fit:
   - Capped mutator choice panel height on narrow widths and enabled natural scroll.
   - Tightened target selection bar sizing on narrow screens.
3. Improved info-bar/room-code readability and touchability:
   - Enabled wrap behavior for info bar groups.
   - Wrapped room-code display controls and increased minimum control heights.
4. Improved landing create/join narrow flow:
   - Stacked join-code row and create-options row.
   - Made join/create submit controls full width on very narrow screens.
5. Improved modal behavior on small screens:
   - Top-aligned modal container with viewport-safe max-height and internal scrolling.
6. Improved active mutator row on very narrow screens:
   - Mutator cards switch to full-width stacked cards for easier scanning.

## Risks found

1. Modal content can overflow mobile portrait viewport without internal scrolling.
2. Fixed right-column game height is too rigid for mobile and small landscape combinations.
3. Room-code controls and info-bar controls can crowd and become hard to tap on narrow screens.
4. Join/create form rows can become cramped in portrait if not stacked.
5. Mutator/history panel height can crowd board/prompt visibility on smaller screens.

## Manual QA checklist (required)

If browser/mobile validation cannot be executed in CI, run these manually:

### Viewports
- Desktop: `1920px` wide.
- Laptop/Tablet: about `1024px` wide.
- Mobile landscape: about `812px` wide.
- Mobile portrait: about `390px` wide.

### Flows
- Create room flow.
- Join room flow.
- Active game with mutator prompts.
- Active game with target selection.
- RPS modal.
- Coin flip modal.
- Game over modal.
- Reconnect/resume recovery screen.

### Pass criteria
- Board remains fully visible and readable without horizontal overflow.
- Prompt/target text remains visible and understandable.
- Room-code controls remain tappable and copy/toggle works.
- Action modals remain usable with all controls reachable.
- Active mutator row remains readable and does not crowd out core board interaction.
- Spectator/info surfaces remain legible at narrow widths.

## Future implementation plan

1. Add a compact “mobile gameplay priority” mode that collapses non-critical surfaces (history/event-heavy panels) while a player action is pending.
2. Add responsive typography tokens for board-adjacent copy (target selection, timer, mutator metadata).
3. Add frontend visual regression snapshots across the four required viewport tiers.
4. Add explicit mobile accessibility pass (focus trap in modals, larger button hitboxes in high-density panels).
5. Add optional per-user preference to pin or collapse the active mutator row.

## Explicit contract confirmation

Confirmed for this PR:

- No gameplay changes.
- No mutator semantics changes.
- No move legality changes.
- No room lifecycle changes.
- No turn-clock lifecycle changes.
- No bot behavior changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.
- No backend logic changes.
