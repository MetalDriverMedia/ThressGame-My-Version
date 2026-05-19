# Stream Mode Audit (Phase E, Narrow)

## Scope and conclusion

This audit treats Stream Mode as a **post-alpha / later spectator-overlay feature**, not an alpha blocker. The concept is valuable because Thress has strong spectator drama, but the current product does not yet have the durable spectator narrative, chronological event feed, overlay viewport, or resolved preset contract needed to market Stream Mode safely.

**Alpha recommendation:** explicitly defer Stream Mode from alpha scope. Alpha should finish the player-first surfaces already identified in the roadmap and companion audits: room creation, join, human-vs-human, human-vs-bot, rematch/recovery, mobile playability, board markers, active mutator readability, player event-feed readability, rule semantics, and balance. Stream Mode should only begin after Spectator Mode is either promoted from optional/future status or consciously scoped as a best-effort public watch view.

This PR is documentation-only. It intentionally preserves gameplay rules, mutator semantics, move legality, room lifecycle internals, turn-clock behavior, bot behavior, Socket.IO event names and payload shapes, and balance.

## Files inspected

- `docs/GAME_COMPLETION_ROADMAP.md`
- `docs/SPECTATOR_MODE_AUDIT.md`
- `docs/REMATCH_FLOW_AUDIT.md`
- `docs/HUMAN_VS_HUMAN_FLOW_AUDIT.md`
- `docs/HUMAN_VS_BOT_FLOW_AUDIT.md`
- `docs/ROOM_CREATION_AUDIT.md`
- `docs/JOIN_FLOW_AUDIT.md`
- `docs/MOBILE_RESPONSIVE_UX_AUDIT.md`
- `docs/PLAYER_PROMPTS_AUDIT.md`
- `docs/BOARD_MARKERS_AUDIT.md`
- `docs/ACTIVE_MUTATOR_DISPLAY_AUDIT.md`
- `docs/EVENT_FEED_AUDIT.md`
- `docs/RULE_SEMANTICS_AUDIT.md`
- `docs/PRESET_RULE_MODES.md`
- `docs/BALANCE_TUNING_AUDIT.md`
- `public/js/main.js`
- `public/js/events.js`
- `public/js/socketHandlers.js`
- `public/js/state.js`
- `public/js/ui.js`
- `public/js/mutatorUI.js`
- `public/js/board.js`
- `public/index.html`
- `public/styles.css`
- `handlers/spectatorHandler.js`
- `handlers/joinHandler.js`
- `handlers/moveHandler.js`
- `handlers/mutatorHandler.js`
- `mutators/mutatorDefs.js`
- `gameManager.js`
- `server.js` (socket wiring only)

## Files changed

- `docs/STREAM_MODE_AUDIT.md`

## Design decision

Stream Mode should be treated as a **combination of spectator UI mode plus an optional rules-preset recommendation**, not as gameplay rules by itself.

- The essential value is presentation: a readable public watch surface, caster-friendly prompt narration, larger chronological event feed, board-marker clarity, and optional OBS/browser-source layout.
- The preset aspect should be secondary and must reuse the future preset resolver proposed in `docs/PRESET_RULE_MODES.md` rather than creating a parallel Stream Mode rules path.
- Stream Mode should not change mutator semantics. Any Stream preset should only resolve to existing compatibility-safe room setup fields such as disabled mutator selection and manual coin-flip default.
- Stream Mode should not be alpha-blocking because Spectator Mode is already documented as optional/future and because event-feed/prompt narration is not complete enough for high-chaos public viewing.

## Stream Mode surface inventory

| Surface | Current source/code path or current absence | Current behavior | Risk / opportunity | Recommended treatment | Timing |
| --- | --- | --- | --- | --- | --- |
| Alpha-scope recommendation | `docs/GAME_COMPLETION_ROADMAP.md` Phase E lists Stream Mode as optional but valuable; `docs/SPECTATOR_MODE_AUDIT.md` defers Spectator Mode | Stream Mode is not implemented or committed as release scope | Risk: shipping “stream” language before the spectator/readability foundation is stable creates false product expectations | Document explicit post-alpha deferral; do not add runtime behavior | **Later / post-alpha** |
| Relationship to Spectator Mode | `handlers/spectatorHandler.js`; `gameManager.isSpectatable`; `gameManager.getSpectatableRooms`; `server.js` `spectateRoom` wiring | Public active human-vs-human rooms can be watched; private and bot games are excluded; spectator state is not durable across refresh without direct watch URL | Stream Mode depends on Spectator Mode for the core watch surface, but Spectator Mode remains best-effort/optional | Promote or harden Spectator Mode first: durable watch URLs/session behavior, clearer errors, richer game metadata, spectator-safe narration | **Prerequisite later PR** |
| Rules preset identity | `docs/PRESET_RULE_MODES.md`; room setup options in `handlers/joinHandler.js`; mutator pool in `mutators/mutatorDefs.js` | Presets are design-only; runtime still uses disabled mutators and manual coin-flip options | Risk: making Stream Mode a standalone rules system would duplicate the future preset resolver and invite semantic drift | Treat Stream Mode preset as a resolver profile only. No separate rules engine, no move legality changes, no mutator behavior changes | **Later preset PR** |
| High-chaos preset relationship | `docs/PRESET_RULE_MODES.md`; `docs/BALANCE_TUNING_AUDIT.md` | Full Chaos and Stream Mode are documented as different audiences: maximum unpredictability vs readable spectacle | Opportunity: Stream can borrow high-visibility moments without inheriting every high-cognitive-load interaction | Keep Stream distinct from Full Chaos. Favor visually legible effects; downweight or exclude effects that are hard to narrate until event feed exists | **Later balance/preset PR** |
| Larger event feed | `docs/EVENT_FEED_AUDIT.md`; `public/index.html`; `public/js/mutatorUI.js`; `public/js/socketHandlers.js` | There is mutator history/status copy but no dedicated chronological event-feed component | High risk: RPS, coin flips, trap triggers, skips, Living Bomb, and Mitosis can be missed by viewers | Build a chronological feed before any Stream-specific rule changes. Map existing events first; add new non-breaking events only in dedicated follow-ups if existing payloads cannot narrate enough | **Later event-feed PR; prerequisite for Stream launch** |
| Readable board markers | `docs/BOARD_MARKERS_AUDIT.md`; `public/js/mutatorUI.js`; `public/styles.css` | Board overlays render marker icons/labels for known persistent effects | Opportunity: existing marker work is a good base; risk remains at stream resolution and high marker density | Add spectator/stream marker legend, priority layering, and high-contrast OBS-safe theme only after player marker baseline is stable | **Later UI polish PR** |
| Spectator-safe prompts | `docs/PLAYER_PROMPTS_AUDIT.md`; `docs/SPECTATOR_MODE_AUDIT.md`; `public/js/mutatorUI.js`; `handlers/mutatorHandler.js` | Player prompts exist for choices/targets/RPS/coin flips; spectators see some room-wide surfaces but not a complete narration-oriented prompt layer | High risk: viewers may not know who is choosing, what is being chosen, or why a pause happened | Add spectator-only narration rows that explain pending choices, target selection, RPS, coin flips, and waiting states without exposing controls | **Later spectator narration PR** |
| Active mutator readability | `docs/ACTIVE_MUTATOR_DISPLAY_AUDIT.md`; `handlers/spectatorHandler.js` serialized `mutatorState`; `public/js/mutatorUI.js` active row | Active mutators and persistent cards render from mutator state, including improved owner/target metadata from prior audit work | Opportunity: strong base; risk is screen density during streaming and spectator viewports | Keep current display. Later add caster-size variant, collapse controls, and clearer “why it matters” summaries | **Later UI mode PR** |
| Public active game metadata | `server.js` `roomsList`; `gameManager.getSpectatableRooms`; `public/js/ui.js` active room rendering | Lobby exposes room code, player names, and spectator count for spectatable public active rooms | Risk: Stream browsing needs turn, move count, active mutator count, preset, and maybe game age; adding this changes payload shape | Do not change now. Later add non-breaking optional metadata fields to `roomsList.active` with tests and client fallback | **Later Socket.IO contract PR** |
| Streamer / overlay needs | Current absence; `public/index.html` game panel and CSS are player/spectator app layout, not overlay layout | No OBS/browser-source route, transparent overlay variant, compact feed-only view, or URL-stable overlay token | Opportunity: overlays could become a major differentiator; risk: supporting overlay before spectator contracts would multiply maintenance | Add only after spectator/event-feed maturity. Consider `/overlay?watch=ROOM`, feed-only/board-only layouts, transparent background option, and CSS viewport presets | **Later overlay PR** |
| Mobile vs desktop spectator tradeoffs | `docs/MOBILE_RESPONSIVE_UX_AUDIT.md`; `public/styles.css` responsive rules | Mobile player UI is improved; spectator mobile is not a dedicated Stream surface | Risk: mobile spectator UI may be useful for casual viewers but conflicts with stream layout priorities | Optimize Stream Mode for desktop/OBS first. Treat mobile spectator view as supported if low-cost but not part of initial overlay requirements | **Post-alpha; desktop first** |
| Future Socket.IO/event-feed needs | `server.js` event names; `public/js/main.js` event registration; `handlers/moveHandler.js`; `handlers/mutatorHandler.js` | Existing events cover gameplay, mutator choices/actions, RPS, coin flips, board updates, clock, and spectator counts | Risk: adding events casually could break clients or duplicate feed logic | Preserve existing names/payloads. If needed, add new additive narration/feed events in dedicated PRs with tests and fallback behavior | **Later contract PR; additive only** |
| Bot-game streaming | `gameManager.isSpectatable` excludes rooms with bots | Bot games are not public spectatable through current listing/handler path | Opportunity for creator demos; risk that bot decisions in chaos-heavy states need extra explanation | Keep excluded for alpha. Revisit only if Stream Mode needs “demo vs bot” rooms and bot prompt narration is added | **Later / optional** |
| Room privacy and streamer control | `gameManager.isPrivate`; `handlers/spectatorHandler.handleDisableSpectating` | Public active rooms are spectatable; private room disable flow exists but private rooms are not public-listed | Streamers need explicit discoverability/privacy controls, not accidental public exposure | Add explicit “public stream room” copy/setting only after spectator policy is finalized | **Later room UX PR** |
| Manual QA readiness | Current absence as a Stream-specific checklist; companion audits include player/spectator scenarios | No Stream Mode implementation exists to test manually | Opportunity to define acceptance criteria before coding | Use the QA scenarios below as future implementation gates | **Later; document now** |

## Answers to design questions

### Is Stream Mode primarily a spectator UI mode, a rules preset, or both?

Primarily a **spectator UI mode**. It may also expose a **Stream preset** later, but that preset must be resolved through the same future preset resolver as Classic, Light Chaos, Standard, and Full Chaos. The UI/event-feed layer is the necessary foundation; a Stream preset without narration would make games more theatrical but not more watchable.

### Should Stream Mode require Spectator Mode to be promoted out of optional/future status first?

Yes. Stream Mode should require at least a deliberate Spectator Mode promotion decision first. It can be a narrow promotion that only guarantees public human-vs-human watch views, but Stream Mode should not ship while the watch surface is considered only an internal/best-effort preview.

### Should Stream Mode reuse the future preset resolver from `docs/PRESET_RULE_MODES.md`?

Yes. Reuse is required. The future resolver should map a `stream` preset to existing room configuration outputs such as derived disabled mutators and manual coin-flip defaults while keeping old `disabledMutators` and `manualCoinFlip` clients compatible.

### Should Stream Mode have a larger event feed before any rule changes?

Yes. A larger chronological event feed should come before Stream-specific rule tuning. The current UI can show status flashes, mutator cards, active rules, and board markers, but it does not persist enough cause-and-effect narration for high-chaos viewing.

### Should Stream Mode include OBS/browser-overlay support later?

Yes, but only later. OBS/browser-source support should be a dedicated overlay PR after spectator URLs, feed narration, and board readability are stable. Likely overlay variants include board-only, feed-only, combined board+feed, transparent background, and fixed 16:9/9:16 viewport presets.

### Should Stream Mode be alpha-blocking or post-alpha?

Post-alpha. It is optional but valuable. Alpha should not block on Stream Mode because the required spectator, event-feed, prompt narration, and overlay foundations are not alpha-essential for player gameplay correctness.

## Future implementation plan

1. **Spectator foundation PR**
   - Decide whether Spectator Mode is promoted beyond optional/future.
   - Add durable watch URLs/session handling if needed.
   - Improve spectate errors and lobby copy.
   - Keep bot/private-room spectating policy explicit.
2. **Player/spectator chronological event-feed PR**
   - Add a dedicated feed component.
   - Map existing socket events into feed rows for moves, mutators, RPS, coin flips, skipped turns, trap outcomes where derivable, and game end.
   - Add frontend tests using representative payload fixtures.
3. **Spectator prompt narration PR**
   - Convert control-oriented prompts into read-only spectator narration.
   - Cover mutator choices, target selection, second-player choices, RPS, coin flips, and pending states.
4. **Preset resolver PR**
   - Implement a single preset resolver from `docs/PRESET_RULE_MODES.md`.
   - Add `stream` as a resolver profile only after Standard/Full Chaos/Beginner behavior is covered by tests.
   - Keep payload changes additive and backward-compatible.
5. **Stream/overlay UI PR**
   - Add caster-friendly layout variants.
   - Add OBS/browser-source route or query-mode.
   - Add high-contrast board markers, larger active-mutator summaries, and feed density controls.
6. **Telemetry/playtest PR**
   - Measure prompt counts, RPS/coin frequency, event-feed density, game length, and viewer comprehension before tuning Stream preset weights.

## Required future tests and manual QA scenarios

Automated tests should be added in the future PRs that implement these surfaces. At minimum, future validation should cover:

- Additive `roomsList.active` metadata does not break clients that ignore unknown fields.
- Spectator sockets cannot emit gameplay actions successfully.
- Feed rendering handles missing optional payload fields.
- Stream preset resolver output is deterministic and backward-compatible with legacy room creation options.
- Overlay route/query mode does not require player credentials and does not expose private rooms unexpectedly.

Manual browser QA scenarios for future implementation:

1. **Stream/spectator view on desktop**
   - Public human-vs-human game appears in Live Games.
   - Watch view opens read-only.
   - Board, names, turn indicator, active mutators, and feed are legible at 16:9 desktop size.
2. **High-chaos game readability**
   - Use a mutator-heavy setup or Stream preset.
   - Confirm viewers can identify the current rule, owner/target, and consequence without player-only knowledge.
3. **Large event feed during mutator-heavy turns**
   - Trigger multiple mutator activations, RPS, coin flips, skipped turns, traps, and game end.
   - Confirm feed remains ordered, scrollable, and not overwhelmed by duplicate rows.
4. **Board marker readability at stream resolution**
   - Test mines, pits, locked squares, Living Bomb, Mitosis, Ice Age, Time Bomb, and targetable square highlights.
   - Confirm marker labels/contrast survive common OBS scales.
5. **Spectator-safe mutator choice display**
   - Watch a chooser receive three mutator options.
   - Confirm spectators see who is choosing and why the game is paused, but do not get actionable controls.
6. **RPS and coin flip spectator narration**
   - Trigger Parry RPS and All On Red / Risk It Rook coin flips.
   - Confirm start, choices/status, result, and consequence are narrated in the feed or spectator prompt layer.
7. **Active mutator row readability**
   - Stack multiple active/persistent rules.
   - Confirm active row remains readable and does not hide the board or feed.
8. **Mobile spectator view if supported**
   - Open watch view on portrait and landscape mobile sizes.
   - Confirm the board remains primary and feed/prompts are usable or intentionally de-emphasized.
9. **OBS/browser-source viewport if considered**
   - Open overlay at common 1920x1080, 1280x720, 1080x1920, and transparent browser-source settings.
   - Confirm no landing/player controls are visible unless intentionally included.

## Explicit deferrals

- No Stream Mode runtime behavior in this PR.
- No Stream preset resolver in this PR.
- No high-chaos or Stream-specific balance tuning in this PR.
- No larger event-feed implementation in this PR.
- No overlay route or OBS/browser-source support in this PR.
- No public active game metadata payload expansion in this PR.
- No new Socket.IO events in this PR.

## Explicit contract confirmation

Confirmed for this PR:

- No gameplay/backend behavior changes.
- No mutator semantics changes.
- No move legality changes.
- No room lifecycle changes.
- No turn-clock behavior changes.
- No bot behavior changes.
- No balance changes.
- No Socket.IO event name changes.
- No Socket.IO payload shape changes.
