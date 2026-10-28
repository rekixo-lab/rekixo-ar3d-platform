# Metro City mobile preview/HD strip and four-status corrections — 28 October 2026

## Target and observed symptom
The published Metro City customer site (exact project ID `c024a562-634d-4e49-b647-43209f6e450b`) starts with a visually correct preview image. A fraction of a second later, as original HD tiles arrive, part of the old image can remain visible as a detached strip along the left of the new masterplan. The layout and saved plot polygons are not the cause of the image split itself.

## Root-cause isolation and fix
- Before the patch, the mobile native-HD layer was made visible over a **permanently painted preview**, even after all the original tiles were ready. On mobile GPUs, a stale preview region under a differently rasterized original tile edge could become visible. The two independently sourced image surfaces must not be visible at once.
- For **Metro City mobile only** (max-width 700px), the original-HD layer and preview are now **mutually exclusive**: the intact preview is visible while tiles load; once *all* current viewport original tiles are created, HD becomes visible and the preview becomes hidden **in one compositor update**. On GPU error or partial coverage the entire HD layer hides and the original preview is restored. On cancel/change of project, preview is restored.
- Overscan is added around native source crops (at least four CSS screen pixels, bounded to 128 source pixels) to avoid mobile rounding exposing the left edge without increasing the entire source size or mutating image/polygon geometry.
- This changes image presentation only. Original image bytes, exact normalized polygon coordinates, SVG viewBox, transforms and 3D engine stay unchanged.
- Critically, the earlier hypothesis of default mobile `cover-fit` being the cause was **incorrect for this symptom**. The patch restores the original first-frame and RST framing behavior; no opening zoom/centering alterations remain.

## Mobile HUD and status filters (from the related request)
- Metro City's four-row status box is 168px → 126px (25% narrower) with smaller row spacing, preserving all four options and Total.
- A release-position guard fixes coarse-pointer selection that was sometimes lost by a `pointerleave` before `pointerup`. Metro 2D SVG/geometry hit-testing now honors the chosen status, consistent with 3D.
- The four Metro overlay colors cannot override active filter exclusion. Sold displays as Registered and Agreement Done remains an orthogonal (non-additive) subset; canonical inventory records are unchanged.

## Verification
- Build and node test suite in GitHub CI.
- Browser E2E now **checks that Metro preview visibility is hidden only after fully painted original HD tiles**, that the original source remains byte-identical, that at least one tile is painted, and that polygon hits/transformed geometry remain stable after promotion.
- Other projects keep their existing preview-under-HD and mobile cover-fit behavior; no other project's original image delivery is changed.
- Real Samsung and iPhone Safari checks after deploy are valuable. If a source file is itself differently cropped relative to saved polygons, a mapper calibration is separately required; a visual render fix cannot logically repair two distinct layouts.
