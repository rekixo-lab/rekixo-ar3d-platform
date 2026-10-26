# Plot Updates — Client Admin minimal-input workflow

## Existing source of truth
- **Plots** inventory status and **Deal Progress** remain authoritative; saving either automatically prepares a private draft. Sales & Accounts' Sold flow also prepares a private draft.
- Use the actual plot number, server-saved event timestamp converted to **Asia/Kolkata** calendar date, and saved status label to avoid re-entering these fields.
- An automatic draft is deduplicated per project, plot, local date, category and label. No new plot status or payment is written by the notice subsystem.
- Status label `Hold` appears in notices as **On Hold**. Token Received alone does not represent money received.

## Client experience
- Plot Updates opens with Ready / Published / Hidden and date+category+status grouping. Multiple plots in the same grouping appear as one concise line.
- Each group has a one-click Publish option; selection checkboxes enable review-first bulk Publish. The endpoint validates every underlying notice against the authenticated project's active plots before the D1 batch writes.
- Client Admin, not Super Admin, decides publication. Hide/Unpublish remain available, and the Super Admin only enables/disables the project module.
- Only unusual backdated/custom announcements need **Custom Announcement (only when needed)**. Its date is prefilled in Indian local time, status selection uses project stages when accessible, and plot numbers can be comma-separated.
- Historical customer samples remain review-required drafts and are never auto-published.

## Public website
- The original masterplan and 2D/3D viewers are unchanged.
- The animated single-line ticker has **#FFEB00 yellow background, #B91C1C red text/lightning icon**, and **New Updates In Plot Status** beside the icon. On narrow screens the title shortens to **New Updates In**, content is ellipsized and remains in the viewport.
- Bell history displays older approved notices; reduced-motion preference is honored. Approved historical news does not change current plot availability.

## Recovery
- Client Admin can Unpublish or Hide individual grouped announcements; Super Admin can disable the module for one project. Existing inventory, mapping, payments and sales ledgers remain untouched.
