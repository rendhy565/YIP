# TMS — Test Credentials

## Demo Accounts (seeded automatically on backend startup)

| Role | Username | Password |
|------|----------|----------|
| Operation | `operation` | `operation123` |
| Finance | `finance` | `finance123` |

## Auth Endpoints

- `POST /api/auth/login` — returns `{ access_token, user }`
- `GET /api/auth/me` — requires `Authorization: Bearer <token>` header

## Notes

- Tokens are JWT (HS256), kept in `localStorage["tms_token"]`
- Token is also injected via axios interceptor on every request
- The seed function is idempotent: on every backend startup, missing users are inserted and existing users' password hashes are re-synced with `.env`.
