# Accessibility

The interface targets WCAG 2.2 AA.

- The custom SVG graph uses named keyboard-focusable nodes.
- Every graph has a structured, screen-reader-friendly list; at 560 px and below it becomes the default surface.
- Simulation changes are announced in an `aria-live` region and repeated as an ordered cascade in the inspector.
- State is encoded with text, geometry, and ordering in addition to color.
- Keyboard focus is visible on controls, fields, graph nodes, and skip navigation.
- Mobile inspectors and editors become bottom sheets with usable touch targets.
- `prefers-reduced-motion` replaces cascade choreography with near-immediate state changes while retaining ordered summaries.
- Text contrast was adjusted from automated axe findings; the production workspace passes the serious/critical axe gate.

Manual review was performed at 1440, 1024, 768, 390, and 320 px. Automated accessibility testing is useful but does not replace screen-reader and keyboard review before a public release.
