# Test Credentials — ARC TMS

## Login URL
`https://plot-expenses.preview.emergentagent.com/arc/login`

## Users (seeded automatically)
| Username  | Password      | Role           |
|-----------|---------------|----------------|
| admin     | admin123      | administrator  |
| operation | operation123  | operation      |
| finance   | finance123    | finance        |

## Notes
- `hr` feature flag ENABLED (PUT /api/feature-flags/hr {"enabled":true}).
- 14 test employees seeded matching the sample files (Abdul Aziz Haddad Mujahid, M. Agus Masrukhan, Reeza Marwan, Jensen Lif, Elvina Abirahma, Dede Jubaedi, Samsir, Iwan Habibi, Ardiansyah, Deni Nugraha, Rachel Putri Indria, Wahyu Addien Althaf, M. Raffy Anwar, Rendhy).
- New feature: Combined payroll import (Absen mesin + Rekap Lembur).

## Sample files (for testing combined import)
- Absensi: https://customer-assets-gfyr7b9c.emergentagent.net/job_03f4ffca-c8a5-4f2b-bb8b-0f6c74d70853/artifacts/2hclwuqo_Rekap_Absensi_Agustus.xlsx
- Lembur: https://customer-assets-gfyr7b9c.emergentagent.net/job_03f4ffca-c8a5-4f2b-bb8b-0f6c74d70853/artifacts/f7adjgwh_Rekap%20Lembur%20Periode%20%2026%20Juli%20-%2025%20Agustus%202026.xlsx

## Quick API test
```bash
TOKEN=$(curl -s -X POST http://localhost:8001/api/auth/login -H "Content-Type: application/json" -d '{"username":"admin","password":"admin123"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")
```
