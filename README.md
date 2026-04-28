# Mind2Mind Memorize

A dependency-free browser memorization app for the current Vegas show script.
The public build keeps the script payload encrypted until the show password is entered.

## Run locally

```sh
npm run serve
```

Then open `http://localhost:4173`.

The local server also enables Save MD, which writes changes back to
`../m2m-files/M2M_Vegas_Full_Script.md` and refreshes the browser data files.
On a static host, Download MD still works, but Save MD is unavailable.

## Refresh the script data

The app data is generated from `../m2m-files/M2M_Vegas_Full_Script.md`.

```sh
npm run extract
M2M_APP_PASSWORD="..." node tools/encrypt_payload.mjs
```

Progress is saved in the browser's local storage. Use Export/Import inside the app to move practice data between devices.
