# BluERSky

A minimalist Bluesky (ATProto) reader for **Even Realities G2** smart glasses, built with `@evenrealities/even_hub_sdk` and `@atproto/api`.

![BluERSky on Even G2](./glasses_20261121152449.png)

## Features

- **Following & Discover Feeds** with endless scroll pagination (fetches the next 25 posts automatically as you reach the end).
- **Notifications View** via the glasses menu to browse likes, reshares (reposts), replies, mentions, quotes, and follows with endless scroll.
- **Detail & Thread View** with word-wrapped multiline post text, scrollable replies, and line progress indicator.
- **Interactive Actions** directly from the glasses: Like/Unlike and Repost/Undo.
- **App Password Authentication** persisted locally via `EvenAppBridge` storage (`setLocalStorage` / `getLocalStorage`) so it works standalone inside the Even App WebView and packaged `.ehpk` builds.

## Glasses Controls

| Input | Feed View | Detail View |
| --- | --- | --- |
| **Scroll Down** | Next post (auto-loads next 25) | Scroll text & replies down |
| **Scroll Up** | Previous post | Scroll text & replies up |
| **Single Tap** | Open post detail + replies | Back to feed |
| **Double Tap** | Exit dialogue (`shutDownPageContainer(1)`) | Back to feed |
| **Hold (Menu)** | Like, Repost, Notifications, Switch Feed, Refresh | Like, Repost, Notifications, Switch Feed, Refresh |

## Authentication

BluERSky uses a **Bluesky App Password** so no external OAuth redirect server is needed:

1. In Bluesky, go to **Settings → Privacy and Security → App Passwords** and create an App Password.
2. Open BluERSky in the **Even App** on your phone (or in the simulator) and sign in with your Bluesky handle and App Password.

## Development & Simulator

```bash
npm install
npm run dev -- --port 5173
```

In a second terminal, launch the EvenHub simulator:

```bash
node ../node_modules/@evenrealities/evenhub-simulator/bin/index.js http://localhost:5173
```

## Build & Package (`.ehpk`)

```bash
npm run build
../node_modules/.bin/evenhub pack app.json ./dist -o bluersky.ehpk
```
