# Test Credentials — ARC TMS

## Login URL
`https://date-filter-refactor.preview.emergentagent.com/arc/login`

## Users (seeded automatically)
| Username  | Password      | Role           | Permissions             |
|-----------|---------------|----------------|-------------------------|
| admin     | admin123      | administrator  | All (full access)       |
| operation | operation123  | operation      | Default operation perms |
| finance   | finance123    | finance        | Default finance perms   |

## Notes
- Passwords come from environment vars `SEED_ADMIN_PASSWORD` etc. — currently default values.
- Administrator bypass: all role checks granted automatically.
- Sender suggestions endpoint currently has no permission gate (any authed user can delete) — future backlog item.

## Quick API test
```bash
# Login
TOKEN=$(curl -s -X POST https://date-filter-refactor.preview.emergentagent.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

# Sample call
curl -s https://date-filter-refactor.preview.emergentagent.com/api/petty-cash -H "Authorization: Bearer $TOKEN"
```
