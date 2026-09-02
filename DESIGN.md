---
name: SAVE MY…
description: A severe operational continuity workspace built from hairlines, evidence typography, monochrome imagery, and faceted spatial objects.
colors:
  field: "oklch(7.5% 0.006 190)"
  surface: "oklch(10.5% 0.007 185)"
  raised: "oklch(14% 0.008 185)"
  line: "oklch(24% 0.008 185)"
  line-strong: "oklch(39% 0.01 185)"
  text: "oklch(95.5% 0.006 96)"
  text-muted: "oklch(66% 0.008 185)"
  blocked: "oklch(67% 0.18 35)"
  uncertainty: "oklch(79% 0.13 82)"
typography:
  sans: "Inter"
  evidence: "Martian Mono"
rounded:
  control: "999px"
  surface: "0px or faceted clip path"
spacing:
  base: "8px"
  section: "24px"
---

# Design system: SAVE MY…

## Creative north star

**The incident table.** A founder or operations lead uses the product on a large monitor in a quiet room while preparing for a consequential absence or outage. The near-black field reduces glare and makes evidence, ownership, and causal motion legible without becoming a neon observability dashboard.

The graph is code-native SVG and HTML. Entities are faceted 3D objects, never rectangular cards: people use octagonal operator prisms, workflows use directional route prisms, services use clipped system slabs, and documents/devices use folded artifact forms. Layered depth planes, raised selection, directional edges, bounded camera focus, and deterministic cascade delay create the spatial experience.

## Identity

- The full wordmark is always `SAVE MY…` using the single ellipsis character.
- The compact symbol is an open continuity bridge crossed by three small isometric blocks; together the blocks form the ellipsis and show work passing across a gap.
- The former raster loop mark is retired.
- The symbol and graph nodes share the same construction: faceted planes, visible depth, mechanical corners, and hairline edges.

## Product hierarchy

1. Personal account.
2. Full-name company switcher.
3. Company navigation: Continuity map, Scenarios, People & roles, Activity.
4. Baseline map, scenario result, and proposed repair are explicit separate states.
5. Manual edits apply immediately; agent changes remain reversible proposals until a person accepts them.

## Color

- Strategy: restrained. Near-black tinted neutrals carry the entire shell.
- White geometry and explicit `VERIFIED` text indicate verified state. Green is not required.
- Vermilion appears only for unavailable, blocked, destructive, or failed state.
- Amber appears only for unknown, stale, or critical attention.
- Proposed structures use dashed neutral geometry, never purple.
- Semantic color stays below ten percent of the interface and is always paired with text, geometry, motion, or ordering.

## Typography

Inter carries names, navigation, controls, and explanatory copy. Martian Mono is the evidence voice: state, version, provenance, compact labels, counts, and the wordmark. Node names use two lines and are never manually sliced.

## Interaction and motion

- Controls: 120–160ms mechanical state feedback.
- Inspectors and dialogs: 200–220ms exponential ease-out.
- Graph camera focus: 360ms `cubic-bezier(0.22, 1, 0.36, 1)`.
- Failure cascade: 110ms per deterministic graph depth.
- Active edges animate direction; proposed edges are dashed neutral hairlines.
- Hovered and selected nodes lift away from their offset depth plane without glow or shadow.
- `prefers-reduced-motion` collapses every animation to an immediate state.

## Responsive behavior

- Desktop: 264px sidebar with full company names and adjacent graph inspector.
- Compact laptop: icon rail while preserving tooltips and clear headings.
- Mobile: bottom navigation, full company heading, graph, and a visible horizontal accessible node list. The inspector becomes a bottom sheet.

## Rules

- Keep the baseline distinct from every scenario and proposal.
- Keep company names visible whenever viewport width allows.
- Use familiar navigation, search, dialogs, forms, and action labels.
- Preserve generated images as desaturated context, never evidence.
- Never show a resilience score or let an agent verify its own proposal.
- Never allow pan or zoom to leave a blank graph viewport.
- Never use decorative gradients, glass, drop shadows, pastel UI fills, identical card grids, or rectangular graph nodes.
