# Metro City mobile original HD tile seam guard

## Scope
Only project ID `c024a562-634d-4e49-b647-43209f6e450b` when loaded in viewport width <=700px. Other builders and desktop keep current masterplan renderer unchanged.

## Problem addressed
On Android/Samsung GPU, 1536px independent HD overlay canvases composited over a compressed preview can show thin boundaries or partially upgraded patches. Their underlying polygon SVG uses the correct logical coordinates, so touching mapping coordinates would make the situation worse.

## Non-destructive mitigation
- Stage and decode all currently visible ORIGINAL-image tiles before promoting the HD layer: no incremental half-HD patches on the displayed preview.
- Smaller 1024px source tiles only for Metro mobile; mobile uses a small overlapping gutter of original pixels (bounded up to 64 source pixels) to prevent fractional compositor seams.
- Retain preview until complete visible coverage. On a canvas drawing/GPU error, hide the entire HD layer rather than exposing a mix of partial tiles and preview.
- Preserve original source bytes and full-quality zoom whenever device allows; density is adaptive as before.
- No edits to saved polygons, image source dimensions, SVG viewBox, normalized coordinates, pan/zoom transform, 3D renderer, R2 assets, booking/status/sales, or project data.

## Tests
Static regression asserts tenant/device gates, original source sampling, atomic promotion/failure fallback and unchanged mapping transforms. Existing all-project original-image browser E2E now includes the exact Metro project ID on mobile, asserts full HD coverage, gutter overlap and the original polygon hit test. Production deploy only after checks pass.

## Caveat
This protects against tile seams caused by compositing and partial painting. A separately cropped historical optimized preview vs original would require asset comparison and must not be guessed or remapped. Real Samsung confirmation after deployment remains useful.
