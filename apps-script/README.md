# Apps Script backend repair

The current production endpoint can read the V10 Sheet but rejects mutations with `Sheet not writable`. Replace the deployed web-app code with `Code.gs` in this folder.

## One-time setup

1. Open the Apps Script project behind the current `PROSPECT_API_URL`.
2. Replace the current web-app handler code with `Code.gs`.
3. In **Project Settings → Script Properties**, set:
   - key: `PROSPECT_API_SECRET`
   - value: the same value already stored in Vercel as `PROSPECT_API_SECRET`
4. Deploy → **Manage deployments** → edit the web app.
5. Set **Execute as: Me**.
6. Keep the access setting compatible with the current server-to-server endpoint.
7. Create a new version and deploy.
8. If Google gives you a new `/exec` URL, replace `PROSPECT_API_URL` in Vercel and redeploy.

The script always opens spreadsheet ID `1K2nfLH1ZBMJZLg0fiicnTJFBzobb3mCKt6rYsEmwR9M` explicitly. It does not rely on an active spreadsheet and it never appends duplicate prospect records for MARK_SENT or REJECT.

## Smoke tests

After deployment, refresh Prospect OS. Then use a prospect you actually contacted:

- MARK SENT should set `Status = SENT` in OPPORTUNITIES and OUTREACH.
- OUTREACH `Sent At` should populate.
- The record should disappear from SEND NOW and appear under SENT.

REJECT should:

- set `Status = REJECTED` in both tabs,
- record the rejection reason in Notes,
- remove the record from SEND NOW.
