# Metro City mobile map and status corrections — 28 Oct 2026

## Scope

Customer-site Metro City only. The masterplan start/reset behavior is gated by the exact published project ID `c024a562-634d-4e49-b647-43209f6e450b` and handset breakpoint (700px). The four-row compact status HUD, hit filtering and input recovery require the existing Metro agreement feature flag. Other projects, tablet/desktop, admin, publishing and database records remain unchanged.

## Source diagnosis

- The shared handset default was CSS/world **cover-fit**, so the image could be deliberately cropped along the left/right or top/bottom depending on viewport ratio and saved focus. Cropping affected both the original preview and overlay world, rather than implying changed polygon coordinates.
- The 2D SVG and geometry fallback used every polygon even when a Metro status filter hid that plot visually. The 3D picker already guarded with its active filter; Metro 2D now does the same.
- Coarse-pointer status choices relied on a transient hover/glass target. On touch release the value could be absent after a pointer-leave event. The handler now resolves the released option from the actual hit target before committing, while deduplicating the synthetic click.
- The Metro 4-row card was explicitly 168px wide. The mobile-specific card is now 126px, with reduced header, row spacing and type while retaining all four named options and Total. Area reduction is greater than 25%.

## Changes and safeguards

- Metro handset initial/reset map scale now uses contain-fit and a centered pan. It remains pinch-zoomable/pannable afterwards. Every loaded image and polygon continues to share **one** transformed world coordinate plane. No polygon rescaling/reassignment or change to source pixels.
- Status filters stay read-only; canonical `available/booked/sold` inventory does not change, and `agreementDone` remains an orthogonal flag. Agreement Done is not added to Total.
- Live status refresh clears an out-of-filter Metro selection. SVG pointer/keyboard, native hit and geometry fallback honor the same active filter as 3D.
- Masterplan native original tile crops, preview fallback, expected dimensions, asset URLs and storage are untouched.

## Device checks after deployment

1. Open Metro City on Android Chrome and iPhone Safari. At startup and after RST, the entire published masterplan should be within the viewport; zoom in to inspect source detail and verify plots remain directly over their saved polygons.
2. Select Available, Booked, Registered and Agreement Done one by one with short taps. Confirm the selected row activates and that tapping a hidden-status plot does not open that plot. Repeat in 3D.
3. Confirm counts match the published/live database. If Agreement Done overlaps Registered, the red subset count should **not** be added to Total.
4. Uploading a different crop/rotation/content of a masterplan may still require a deliberate mapper recalibration and publish. Matching image **aspect ratio** alone cannot establish matching physical plot alignment; do not auto-shift existing polygons.
5. Verify another project and desktop/tablet retain prior cover/contain and status layouts.

## Testing

`node --test tests/public-status-filter-compact-v2.test.mjs tests/metro-mobile-full-plan-and-hit-filter.test.mjs tests/project-start-view-runtime.test.mjs tests/metro-four-public-status.test.mjs tests/public-mobile-presentation.test.mjs`

Full browser regression runs on the pull request. Real-device validation is still necessary, especially for large decoded original images on mobile GPU.
