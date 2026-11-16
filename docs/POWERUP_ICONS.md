# Gridwar SVG Power-Up Icons

This branch is based on the **merged main branch**. The unfinished `feature/one-use-wall-shield` branch is intentionally excluded; no gameplay, collision, scoring, authentication, or WebSocket code has been changed.

## Visual set

| Server power-up | SVG asset | Map rendering |
| --- | --- | --- |
| Speed Boost | `client/static/img/powerups/speed.svg` | Golden lightning bolt |
| 1 — Shield | `client/static/img/powerups/shield.svg` | Blue protective shield |
| 2 — Radar | `client/static/img/powerups/radar.svg` | Purple scanning radar |
| 3 — Ghost Mode | `client/static/img/powerups/ghost.svg` | White ghost silhouette |
| 4 — Double Score | `client/static/img/powerups/double.svg` | Two golden stars |
| 5 — Trail Repair | `client/static/img/powerups/repair.svg` | Green repair wrench |

All SVGs are transparent-background, self-contained 64 × 64 vector artwork and scale down to the 2×2 (20 world-unit) collectible patches. The map badges retain their four-tile footprint and color-coded outline; the center has a dark backing to keep icons readable on territory owned by any player.

The images are preloaded and cached once, then drawn onto the existing game Canvas. If an icon has not loaded yet, a neutral loading glint appears temporarily. No icon is loaded inside a frame loop.

The HUD shows each icon beside its power-up name and countdown. Trail Repair remains labeled “ready” until its charge is used; Speed Boost uses the new lightning SVG instead of a text emoji.

## Preview

Start the development server:

    deno task dev

Open the standalone visual preview page:

    http://localhost:8080/client/powerups-preview.html

It includes the six full-size icons and a map-style 2×2 tile sample. The actual game is unchanged aside from how pickups and the HUD look. To verify in a match, open:

    http://localhost:8080/client/

## Validation

- `tests/powerUpIcons.test.js` confirms the five ID-to-icon mappings match the server's `POWER_UP_TYPES` order.
- The tests check all six SVG files exist, are scalable vector files, and contain titles.
- A Canvas mock verifies the renderer draws a four-tile marker and preserves drawing state.

After merging, replace an icon by updating the corresponding SVG file without rewriting the game renderer. Any future Wall Shield icon should be added in a separate branch after the gameplay issue is resolved.
