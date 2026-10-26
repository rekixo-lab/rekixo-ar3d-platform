# Metro City Plot Update Notifications

## Ownership and workflow
- Super Admin can enable or disable the module **per project**; it is **not an approval gate**.
- Metro City Client Admin → Plot Updates can create dated drafts, publish, hide or unpublish the notices independently.
- Automatic Booked/Sold/Available and Deal Progress changes create private drafts, never public notices automatically. The original status/money/geometry is never modified by the notification system.
- Three customer-provided examples from 12 October 2026 are PRIVATE historical drafts until the Client Admin checks and publishes them.
- Public endpoint returns only approved notices belonging to the resolved project; no personal data, money, notes or author identifiers.
- Other projects start with the feature disabled.

## Public display
- Compact, single-line slide-down banner emerges from the header, with no overlay changes to 2D/3D canvas.
- Mobile fits within the viewport, single line ellipsizes long updates, bell opens date-wise history and reduced-motion preferences are respected.
- Historical notices are dated historical events, not assertions of present-day booking availability.

## Safety and undo
- Turning module OFF hides the public bell and ticker without deleting drafts.
- Client Admin can Unpublish any notice.
- Migration creates new project-scoped tables and no updates to existing project or sales data.
- Existing normalized plot coordinates, bookings, payment ledgers and customer masterplan are untouched.
