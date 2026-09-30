# Apply Prospect OS V10.1

This bundle contains only the files changed by the V10.1 surgical patch.

From Terminal:

```bash
cd "/Users/markkrizsan/Documents/ChatGPT/Prospect OS"
```

Copy/overwrite this bundle's contents into that folder, preserving the folder structure, then run:

```bash
npm test
npm run typecheck
npm run build

git add .
git commit -m "Patch Prospect OS V10 execution flow"
git push
```

Because Vercel is connected to `main`, the push should deploy automatically.

Then repair/redeploy the Apps Script using `apps-script/README.md`.

Expected production changes:

- OPEN ZOHO opens `https://mail.zoho.com/`.
- The UI reads the real V10 Sheet headers instead of showing false `Not recorded` values.
- Legacy `V9-*` database IDs are de-emphasized; the card reads V10.
- A REJECT action records a reason and removes bad-fit prospects from SEND NOW.
- MARK SENT and REJECT re-read the Google Sheet and only report success after confirmation.
