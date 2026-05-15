# GhostLabs Budget Tracker

A browser prototype for tracking budgets, sign-in scoped expense history, account sync, and receipt capture. It runs locally without a backend and can sync across devices when connected to an account sync API.

## Run

Open `index.html` in a modern browser. For camera access, use a local web server or a browser context that treats local files as secure.

For account sync, run the included API server:

```powershell
node sync-server.js
```

Then open `http://127.0.0.1:8787`.

## Share with others

Do not share a `127.0.0.1` or `localhost` link. Those addresses point to each person's own computer.

Publish this folder to a static host such as Netlify, Vercel, or GitHub Pages, then share the public `https://...` URL. See `DEPLOY.md` for steps.

## What works now

- Sign in with a name and email.
- Save expense history per account.
- Add income from paychecks, transfers, clients, or other sources.
- Search, filter, delete, and export expenses.
- Set monthly category budgets.
- View an expense-category pie chart and percentage wheels for spent income, remaining income, and budget usage.
- Use the app on mobile and desktop layouts.
- Capture or upload receipt photos.
- Paste receipt OCR text and parse merchant, total, date, payment, and category guesses.
- Sync across devices with the same email/password account when an account sync API is configured.
- Share button that works after the app is hosted publicly.

## Account sync setup

The project includes a local account sync API in `sync-server.js`. It serves the app and stores account ledgers in `data/account-sync.json`.

For a hosted deployment, run this API on a server and set `apiBaseUrl` in `account-sync-config.js` to the public API URL.

```js
window.GHOSTLABS_ACCOUNT_SYNC = {
  apiBaseUrl: "https://your-sync-api.example.com"
};
```

The app expects these endpoints:

- `POST /auth/session` with `{ email, password, name }`, returning `{ token }`.
- `GET /ledger`, returning the signed-in account ledger.
- `PUT /ledger` with the ledger payload to save it for the signed-in account.

Without an account sync API, GhostLabs keeps working with local-only saves on the current device.

## Production notes

Receipt OCR still needs a production OCR service such as Google Document AI, AWS Textract, Azure AI Vision, or a server-hosted Tesseract worker.
