# TMS — Order-to-Cash & Logistics (PRD)

## Original Problem Statement
Build a complete, production-ready Order-to-Cash and Logistics Transportation Management System (TMS) with RBAC (Operation & Finance), AWB orders, vendor/cash cost plotting, monthly recap with Excel export & reconciliation, invoice + faktur pajak + lampiran + PO printing, payment closing, P&L reports.

## Tech Stack (user choice)
- Frontend: React 18 + React Router 6 + Tailwind + lucide-react + SheetJS (xlsx) + sonner toasts
- Backend: FastAPI + Motor (MongoDB async) + bcrypt + PyJWT
- DB: MongoDB (default container instance)
- Excel: SheetJS in the browser
- PDF: browser `window.print()` + `@media print` CSS
- UI Language: Bahasa Indonesia

## User Personas
1. **Operation** — Input AWB orders, input Vendor (Accrue) costs, generate Excel rekap, handle reject (revert), create invoices.
2. **Finance** — Input Operational/Lintas (Cash) costs, settle Accrue→Cash, mark invoices Paid, see P&L.

## Core Static Requirements
- RBAC strictly enforced server-side (`require_role`) and reflected in the sidebar.
- AWB auto-numbering `AWB-YYYYMM-XXXX`, invoice `INV-YYYYMM-XXXX` (sequential).
- AWB status machine: `Open → Reconciled → Invoiced → Paid` with revert from Reconciled to Open.
- Cost rules:
  - Operation can input only `Vendor` (auto `Accrue` + `is_settled=false`).
  - Finance can input only `Operational` / `Lintas` (auto `Cash` + `is_settled=true`).
  - Finance can settle any Accrue → Cash.
- Dynamic tax via `settings` (`tax_ppn_0`, `tax_ppn_11`, `tax_ppn_12`).
- Contract autofill: selecting a customer's contract locks origin/destination/tariff in Order Input.

## Implemented (2026-01-08)
- **Module 1 — Order Input** with AJAX contract autofill, auto-calculation panel (`total_tariff`, `tax_amount`, `grand_total`), AWB auto-number.
- **Module 2 — Cost Plotting + Accrue Settlement** with strict role rules + settle-to-cash flow.
- **Module 3 & 4 — Monthly Recap & Reconciliation** with SheetJS Excel export, multi-select, and revert handling.
- **Module 5 — Invoices** with creation (idempotent), bulk Excel `Lampiran` export, and print dashboard (Invoice + Faktur Pajak + Lampiran + PO Placeholder) using `window.print()`.
- **Module 6 — Payment & Closing** with `Mark as Paid` (Finance).
- **Module 7 — P&L Report** with month + customer filters, per-AWB net profit, summary KPIs, Excel export.
- Master CRUD: Customers, Contracts, Settings (tax + company profile).
- Auth: JWT (HS256, 12h), bcrypt, idempotent seed of operation/finance demo users.
- Dashboard with status counters, revenue, costs, outstanding accrue, quick links.
- Sample seed: 3 customers, 4 contracts, 5 AWBs (one per status), 10 costs, 2 invoices.

## Verified
- Backend pytest: 20/20 passed.
- Frontend flows: all required user journeys verified by testing agent (login → input order → recap → invoice → print → mark paid → P&L).
- Idempotency bug on `POST /api/invoices` fixed (existing-invoice check now runs before status guard).

## Prioritized Backlog (P0/P1/P2)
- **P1** — Export Lampiran as **separate file per invoice** when only one is selected (constraint says "1 file per attachment, or multi-tab if bulk"). Current implementation always uses multi-tab. Easy to branch in `bulkExport()`.
- **P1** — Optional: opt-in to React Router v7 future flags to silence console warnings.
- **P2** — Split `server.py` into `routers/{auth, orders, costs, invoices, reports}.py` before adding more modules.
- **P2** — Add a Customer/PO upload field for the "PO Placeholder" page.
- **P2** — Edit-Order screen (currently only create).
- **P2** — Excel template branding (header/logo, color, page footer).
- **P2** — Dashboards: monthly trend chart, aging report for unpaid invoices.

## Next Action Items
- Implement single-file Lampiran branching (P1).
- Consider splitting backend into routers (P2).
- Add edit & delete order screens (P2).

## Iteration 2026-01-08 (later) — Administrator + Recurring Fixed Cost
- New role **administrator** seeded as `admin / admin123` with full access + the new module `user_management`.
- New collection `users.permissions[]` (per-user module access list) + `users.active` flag.
- New page `/users` (admin-only) with create, edit (role + permission checkboxes), reset password, soft-disable (active toggle), delete. Guardrails: cannot delete/demote/disable the last administrator; cannot delete self.
- `GET /api/modules` returns canonical module catalog (13 modules). Used by the User form to render permission checkboxes.
- Sidebar (`Layout.js`) became **permission-driven** (`hasPerm(user, item.perm)`); administrator always shows everything; non-admin sees only the modules their `user.permissions[]` allows.
- `App.js` `Protected` auto-allows administrator on any `roles={[...]}` route.
- Backend `require_role` auto-includes administrator; `POST /api/costs` allows admin for both Vendor and Operational/Lintas categories.
- New endpoint `POST /api/fixed-costs/copy` (Finance) with `{ source_month, target_month, overwrite }`. Frontend `FixedCosts.js` has new "Salin ke Bulan Berikutnya" button → modal with target month (defaulted to next month) + overwrite toggle. After copy the page auto-navigates to the target period and shows the copied rows (each with `copied_from_month` metadata).
- Login page now has 3 demo buttons (Administrator / Operation / Finance).

## Verified
- API smoke: admin can post Vendor + Operational costs, operation cannot create users (403), cannot demote last admin (400 with proper message), copy fixed costs across months works, custom-permission users return only their allowed perms.
- UI screenshots (desktop): User Management list, Create user dialog (13 perm checkboxes), FC copy dialog, FC after-copy view, admin Dashboard with full sidebar + ADMINISTRATOR section.
