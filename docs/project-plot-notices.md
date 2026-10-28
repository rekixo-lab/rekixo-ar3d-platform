# Metro City Plot Update Notifications

## Ownership and workflow
- Super Admin can enable or disable the module **per project**; it is **not an approval gate**.
- Client Admin → Plot Updates supports manual drafts, publish, hide and unpublish. The admin's normal plot status changes publish automatically when the project notice feature is enabled.
- Successfully saved user-facing Available/Booked/Registered (Sold elsewhere) and Deal Progress changes automatically publish a notice with only the public status label and plot number. Metro City's Agreement Done checkbox is eligible. The original status/money/geometry is never modified by the notification system. Private notes, buyer identity, money, arbitrary fields, and actor IDs never reach the public API.
- Three customer-provided examples from 12 October 2026 remain stored as private historical drafts unless explicitly published; old dates are not shown in the current daily ticker.
- Public endpoint returns only approved notices belonging to the resolved project; no personal data, money, notes or author identifiers.
- Other projects start with the feature disabled.

## Public display
- Compact, single-line slide-down banner emerges from the header, with no overlay changes to 2D/3D canvas.
- Mobile fits within the viewport, one-line notices show only today's India date, and bell lists today's notices. When the IST date changes, yesterday's banner and bell contents expire, even if the visitor keeps the site open. Older records remain in admin audit/history.
- Historical notices are dated historical events, not assertions of present-day booking availability.

## Safety and undo
- Turning module OFF hides the public bell and ticker without deleting drafts.
- Client Admin can Unpublish or Hide any notice; manually hidden automatic notices are not republished simply because the same plot was saved again on that day.
- Migration creates new project-scoped tables and no updates to existing project or sales data.
- Existing normalized plot coordinates, bookings, payment ledgers and customer masterplan are untouched.
