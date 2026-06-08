# TMS — Test Credentials

## Demo Accounts (seeded automatically on backend startup)

| Role | Username | Password | Default Permissions |
|------|----------|----------|---------------------|
| Administrator | `admin` | `admin123` | All 13 modules (full access + user management) |
| Operation | `operation` | `operation123` | orders_input, orders_list, recap, invoices, costs, customers, contracts, pnl, settings |
| Finance | `finance` | `finance123` | orders_list, invoices, payments, costs, accrue, fixed_costs, customers, contracts, pnl, settings |

## Auth Endpoints

- `POST /api/auth/login` — `{ username, password }` → `{ access_token, user { id, username, role, full_name, permissions[], active } }`
- `GET /api/auth/me` — requires `Authorization: Bearer <token>` header

## Administrator Endpoints

- `GET /api/modules` — list of 13 modules with default roles
- `GET /api/users` — list all users (admin only)
- `POST /api/users` — create user `{ username, password, role, full_name?, permissions? }`
- `PUT /api/users/{id}` — update `{ full_name?, role?, permissions?, active? }`
- `PUT /api/users/{id}/password` — reset password `{ password }`
- `DELETE /api/users/{id}` — delete user
- Guardrail: cannot delete or demote the last active administrator; cannot delete self.

## Notes

- Tokens are JWT (HS256, 12h), kept in `localStorage["tms_token"]`.
- Permissions are stored per-user; admin sees all menus regardless.
- `POST /api/fixed-costs/copy` (Finance) — copies all fixed costs from `source_month` to `target_month`, optional `overwrite=true` to delete target before copying.
- Backend auto-allows administrator on any `require_role(...)` route, including business rules like cost category posting.
