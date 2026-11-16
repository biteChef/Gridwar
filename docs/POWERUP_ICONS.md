# Gridwar WebP Power-Up Icons

This branch is based on the **merged main branch**. The unfinished `feature/one-use-wall-shield` branch is intentionally excluded; no gameplay, collision, scoring, authentication, or WebSocket code has been changed.

## Visual set

| Server power-up | WebP asset | Map rendering |
| --- | --- | --- |
| Speed Boost | `client/static/img/powerups/speed.webp` | Golden lightning bolt |
| 1 — Shield | `client/static/img/powerups/shield.webp` | Golden protective shield |
| 2 — Radar | `client/static/img/powerups/radar.webp` | Green scanning radar |
| 3 — Ghost Mode | `client/static/img/powerups/ghost.webp` | White ghost silhouette |
| 4 — Double Score | `client/static/img/powerups/double.webp` | Two golden stars |
| 5 — Trail Repair | `client/static/img/powerups/repair.webp` | Golden repair wrench |

All six approved first-generation icons are optimized, transparent 112 × 112 WebP game sprites that scale down to the 2×2 (20 world-unit) collectible patches. The map badges retain their four-tile footprint and color-coded outline; there is no circular backing: the icons' built-in outlines keep them readable over each player's territory.

The images are preloaded and cached once, then drawn onto the existing game Canvas. If an icon has not loaded yet, a small neutral square appears temporarily. No icon is loaded inside a frame loop.

The HUD shows each icon beside its power-up name and countdown. Trail Repair remains labeled “ready” until its charge is used; Speed Boost uses the new lightning WebP instead of a text emoji.

## Preview

Start the development server:

    deno task dev

Open the standalone visual preview page:

    http://localhost:8080/client/powerups-preview.html

It includes the six full-size icons and a map-style 2×2 tile sample. The actual game is unchanged aside from how pickups and the HUD look. To verify in a match, open:

    http://localhost:8080/client/

## Validation

- `tests/powerUpIcons.test.js` confirms the five ID-to-icon mappings match the server's `POWER_UP_TYPES` order.
- The tests check all six WebP files exist, have WebP headers and transparency.
- A Canvas mock verifies the renderer draws a four-tile marker and preserves drawing state.

After merging, replace an icon by updating the corresponding WebP file without rewriting the game renderer. Any future Wall Shield icon should be added in a separate branch after the gameplay issue is resolved.
