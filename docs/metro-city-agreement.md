# Metro City — Registered label and Agreement Done

Scope: Verified Metro City project ID c024a562-634d-4e49-b647-43209f6e450b, matching slug/name. Other projects remain unchanged.

Customer website displays Registered where canonical status is booked; it is a presentation-only label, not proof of legal registration. Original 2D/3D status filters, colors, inventory and Sales Ledger remain unchanged.

Client Admin Plots rows have auto-saving Agreement Done checkbox using private existing Custom Fields storage. Missing values are Agreement Pending. Current Agreement Done/Registered deal stages backfill true during migration. New completed-stage saves set the independent flag true in the same D1 batch. Changing unrelated stages never clears completed agreement.

Public startup and live polling (~30s) expose only Agreement Done boolean for Metro. Owner, booking amount, broker, notes, payments remain private. Public plot popup shows Agreement Done or Agreement Pending.

Admin can uncheck if mistaken; no masterplan upload or republish required.