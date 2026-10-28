# Metro City — Four public status colors (project scoped)

The fourth option **Agreement Done** is a read-only public overlay/filter. The three canonical inventory statuses remain `available`, `booked`, `sold` and retain their exact plot IDs, counts and sale/booking logic. Only the verified Metro City project with enabled `agreement_done` custom field gets this presentation.

Public colors: Available white (#FFFFFF), Booked yellow (#FFD21A), Registered green (#1ED46B, underlying sold), Agreement Done red (#FF3030). Red has visual priority if the existing Client Admin checkbox is ON. Public popup shows Agreement Done only when ON and no row when OFF. Four filters can overlap (Agreement Done is also part of its underlying inventory), so Agreement Done count is **not** added to total. 2D SVG and WebGL 3D both reference the same per-plot Boolean, with unchanged polygon meshes, hit-testing and source HD masterplan.

Client Admin Plots retains authenticated, revision-safe, auto-saving Agreement Done checkbox and shows Registered instead of Sold. Deal Progress hides only its Agreement Date custom field in Metro City UI, leaving saved values intact. No data migration, reclassification or masterplan upload.

Regression checks should verify other projects remain 3-option, fourth filter only Metro, mobile 4-row layout, live ON/OFF updating 2D and 3D, numeric totals and all original polygon interactions.
