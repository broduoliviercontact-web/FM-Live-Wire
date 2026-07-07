# PRD Rubric Review — FM Live Wire (MVP)

Reviewer: rubric-walker (PRD quality)
Date: 2026-07-06
Target: `prd.md` + `addendum.md`
Product: FM Live Wire — one-way live MIDI broadcast web tool (MIDI events, NOT audio).

## Gate verdict

**PASS-WITH-FINDINGS**

The PRD is strong: complete Essential Spine, stable globally-numbered FR IDs, internally consistent with all 10 stated invariants, MVP discipline tight, traceability sound, French coherent. A handful of findings below are refinements, not blockers — none contradicts the core invariants (one-way, single performer, read-only listeners, no SysEx, no DB, no chat/jam).

## Dimension-by-dimension

### 1. Completeness — Essential Spine — PASS

All 10 spine elements present and substantive:
- Vision §1; Objectives O-1..O-5 §2; Non-goals N-1..N-10 §3; Personas P-1/P-2 + audience §4; User journeys UJ-1/UJ-2 §5; FRs §6 (FR-1..FR-30); NFRs §7 (NFR-1..NFR-20); Success criteria S-1..S-10 + counter-metrics §8; Risks R-1..R-12 §9; Open questions Q-1..Q-7 §10; Epics E1..E6 §11; Stories §12; Annexes §13.
- Addendum supplies the "why/how" depth (invariants, transport, auth, backpressure, Panic, security, manual test plan, ADRs, rejected alternatives, persona depth, package caveat, W3C open).

No spine element is missing or stub-only.

### 2. FR quality — PASS

- Stable, globally-numbered IDs FR-1..FR-30, grouped under 6.1–6.6 (role/access, capture/relay, listener render, security/one-way, backpressure, ops). No ID collisions, no re-used numbers.
- Capability-level phrasing dominates (e.g. FR-13 "remappage forcé", FR-16 "Panic local … fonctionne même déconnecté du serveur", FR-22 "token bucket capacity 200, refill 100/s"). Implementation specifics (lookahead 40 ms, BUFFER_CAP 256, MAX_LATE_MS 200) are stated as constraints, not as dictated code — acceptable for an MVP contract that pins behavior.
- Testable: each FR maps to either an automated test target (NFR-16 list, Story 6.1) or a manual test step (§A.7 11 steps). Acceptance criteria in stories are concrete and falsifiable.

Minor: a few FRs interleave rationale notes (`[NOTE FOR PM]`) inside the requirement body. Cosmetic; does not impair testability.

### 3. Internal consistency — PASS (one nit)

Cross-check of FRs / NFRs / journeys / epics vs the 10 invariants (addendum A.1):

| Invariant | Where enforced | Consistent? |
|---|---|---|
| One-way | FR-18, FR-19, FR-20, NFR-11, Epic 2 (role gate) | yes |
| Owner unique | FR-4, FR-5, Story 2.3 (`PerformerRegistry`), S-3 | yes |
| No SysEx | FR-8, FR-21, Story 3.2 (filter), A.6 | yes |
| Panic local (server-down) | FR-16, FR-18 (no server handler), Story 5.3, S-2, A.5 | yes |
| HTTPS | NFR-8, FR-23, R-2 | yes |
| Chrome/Edge | NFR-6, NFR-7, Story 4.1 | yes |
| Web MIDI native | NFR-12, ADR-0003 | yes |
| In-memory, no DB, no Redis | NFR-13, N-8, ADR-0004 | yes |
| Strict validation | FR-21, NFR-12, Story 1.2 | yes |
| Owner secret server-side | FR-2, NFR-9, NFR-10, A.3, S-7 | yes |

No contradiction with one-way / single-performer / read-only / no-SysEx / no-DB / no-chat. FR-18 explicitly forbids `midi:event` handler listener-side and lists the only 3 allowed listener→server events (`room:join`, `room:leave`, `midi:test`) — this correctly rules out bidirectional chat/jam.

Nit (FR-26 vs NFR-2 vs Q-1): the late-event policy (fallback noteOn/noteOff, drop CC HF) is asserted as a requirement in FR-26 and as a target in NFR-2 (< ~5 % fallbacks), yet Q-1 still lists the fallback-vs-drop policy as "à finaliser à l'implémentation". Resolve: either close Q-1 (FR-26 already decides) or rewrite FR-26 as "default policy, tunable via Q-1". Currently reads as both decided and open.

### 4. MVP discipline — PASS

Non-goals N-1..N-10 are explicit and broad: audio streaming, SysEx/presets, replay/generative, multi-room, JWT/RBAC, multi-performer, jam, chat, advanced latency compensation, MIDI clock/transport, scale-out, CDN, DB persistence, Safari polyfill, mobile. The future-mode statement ("multi-performer est un mode futur séparé, pas une évolution naturelle du cœur MVP") correctly fences off the most tempting creep path.

Scope creep scan: no FR introduces a feature outside the non-goals fence. The only borderline items (Force Panic FR-17, Mock/Debug mode FR-12/FR-14) are tightly scoped as opt-in dev/validation affordances and explicitly justified by NFR-19 / Story 4.2. Acceptable.

### 5. Traceability — PASS (one nit)

- Each Epic maps to a coherent FR cluster: E1→FR-2,FR-8,FR-10,FR-15,FR-21,NFR-8,NFR-12; E2→FR-1..FR-5,FR-18..FR-23,FR-28,FR-29; E3→FR-6..FR-10; E4→FR-11..FR-15,FR-18,NFR-6,NFR-7; E5→FR-16,FR-17,FR-24..FR-27,NFR-5; E6→NFR-16..NFR-19,S-9.
- Stories within each epic carry ACs that reference FR IDs or NFR targets. Story sizes look one-session-able: scaffold, schema, mapping fn, `/health`, `io.use`, timing-safe compare, registry, role gate+rate limit, handler, origin allowlist+shutdown, performer page+token, MIDI capture, monitoring+relay, disconnect, listener page+feature detect, output select+mock, channel remap, room join+scheduling, test note, scheduler+buffer, fallback/drop, panic, force panic+fail-safe, unit tests, integration tests, manual plan, zero-secret grep+ADRs. Each is a single cohesive code unit.
- Cross-references in ACs are explicit (e.g. Story 6.4 lists ADRs 0001–0008 by name).

Nit: Story 5.4 bundles **two** concerns (Force Panic opt-in + fail-safe disconnect). Both are small but they enforce different FRs (FR-17 vs FR-24) and different test paths. Consider splitting into 5.4 (Force Panic) and 5.5 (fail-safe on disconnect) so each session has one AC set. Not blocking.

### 6. Risks & open questions — PASS

Risks R-1..R-12 each carry probability, impact, and an MVP mitigation that names a concrete FR/Story (e.g. R-4→`PerformerRegistry`+`performer:busy`; R-7→double defense; R-9→no `VITE_*`). R-11 and R-12 are unusually honest (W3C open, research-coverage caveat) — real and actionable.

Open questions Q-1..Q-7 are scoped (implementation-time decisions, post-traction roadmap, UX nuance) and each is small enough to defer without blocking Epic start. Only Q-1 overlaps with an already-decided FR (see §3 nit).

### 7. Language — PASS

The PRD is genuinely and consistently in French (headings, body, FR/NFR phrasing, stories, ACs, addendum). Tone is appropriate (technical PM French with English tech terms retained: `lookahead`, `token bucket`, `lookahead`, `room:join`). Minor occasional English term borrowing is normal in MAO/MIDI context and not a coherence issue. Frontmatter `language: fr` matches content. No mixed-language headings or untranslated sections.

## Findings (top)

1. **[Low] FR-26 / NFR-2 / Q-1 tension (§6.5, §7, §10).** FR-26 asserts the late-event policy (fallback for noteOn/noteOff, drop CC HF) as a requirement, NFR-2 sets a < ~5 % fallback target, yet Q-1 still marks the fallback-vs-drop policy as "à finaliser à l'implémentation". Either close Q-1 (already decided) or relabel FR-26 as the default-tunable policy. Affects: implementation sign-off clarity.
2. **[Low] Story 5.4 bundles two concerns (§12, Epic 5).** Force Panic (FR-17) and fail-safe-on-disconnect (FR-24) are distinct FRs with distinct test paths. Split into 5.4 / 5.5 for cleaner one-session sizing and AC traceability. Affects: traceability, session planning.
3. **[Info] Stable IDs present and clean.** FR-1..FR-30 globally numbered, no collisions; NFR-1..NFR-20, S-1..S-10, R-1..R-12, Q-1..Q-7, O-1..O-5, N-1..N-10, UJ-1/2 all stable. No fix needed — noted as a strength.
4. **[Info] Invariant coverage is total.** All 10 invariants (A.1) are each enforced by ≥1 FR, ≥1 NFR, ≥1 story, and (where applicable) a success criterion or risk. No invariant is asserted only in the addendum without PRD backing. No fix needed.
5. **[Info] `[NOTE FOR PM]` blocks inside FR bodies (FR-13, FR-26 area).** Cosmetic only; consider moving notes to a marginal callout so the requirement text reads as a pure contract. Not blocking.

## Conclusion

PASS-WITH-FINDINGS. No invariant violations, no scope creep, no missing spine element, no ID instability, no language inconsistency. The two Low findings (Q-1 cleanup, Story 5.4 split) are refinements that can be addressed at grooming without re-opening the PRD. The document is ready to drive architecture and story implementation.