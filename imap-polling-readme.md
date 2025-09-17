# IMAP Poller (Development Only)

This repository includes a lightweight IMAP polling utility that can be used during development to pull new messages from any
mailbox that exposes an IMAP endpoint (Gmail, Outlook, Fastmail, self-hosted, etc.). The poller signs in with standard IMAP
credentials, keeps a cursor on disk so each message is processed once, and invokes a stubbed `processMessage()` hook for your
own downstream processing.

## Features

- Runs locally on `localhost` with no public endpoints, tunnels, or OAuth flows required.
- Uses [`imapflow`](https://github.com/postalsys/imapflow) to establish an efficient IMAP IDLE-compatible connection.
- Stores connection state (cursor and a rolling UID cache) under `./tokens/imap-poll-state.json` so messages are not reprocessed
  between restarts.
- Polls a configurable mailbox at a configurable interval, logging the sender, subject, and received timestamp for each new
  message before calling `processMessage()`.

## Prerequisites

1. **Ensure IMAP is enabled for the mailbox you plan to read.**
   - For hosted providers (Gmail, Outlook.com, Yahoo, Fastmail, etc.) enable IMAP in the account settings if it is not already
     active.
   - For Gmail and other providers that no longer support "less secure" passwords, create an App Password and use that instead
     of your primary account password.
   - If you host your own mail server, confirm that the IMAP service is reachable from your development machine.
2. **Collect the connection details.** You will need the hostname, port, TLS requirements, username, and password (or app
   password) for the IMAP account.

## Local configuration

The poller reads configuration from environment variables. Export them in your shell or place them in an `.env.local` file at
the repository root (dotenv is loaded automatically).

| Variable | Required | Description |
| --- | --- | --- |
| `IMAP_HOST` | ✅ | Hostname or IP address of the IMAP server (e.g. `imap.gmail.com`). |
| `IMAP_PORT` | ✅ | Port for the IMAP server (typically `993` for TLS or `143` for STARTTLS/plain). |
| `IMAP_SECURE` | Optional | Set to `true` to require an implicit TLS connection (default: `true` when the port is `993`). |
| `IMAP_USER` | ✅ | Username for the IMAP account. |
| `IMAP_PASSWORD` | ✅ | Password or app password for the IMAP account. |
| `IMAP_MAILBOX` | Optional | Mailbox/folder to poll (default: `INBOX`). |
| `IMAP_REQUIRE_UNSEEN` | Optional | When `true`, only fetches messages that are still marked unseen/unread (default: `false`). |
| `IMAP_POLL_INTERVAL_SECONDS` | Optional | Seconds between poll cycles (default: `30`). |
| `IMAP_INITIAL_LOOKBACK_MINUTES` | Optional | How far back to look for messages when the cursor file does not exist (default: `5`). |
| `IMAP_POLL_MAX_RESULTS` | Optional | Maximum number of messages fetched per poll (default: `25`). |
| `IMAP_RECENT_MESSAGE_MEMORY` | Optional | Number of recent message UIDs to remember to avoid duplicates (default: `50`). |
| `IMAP_TLS_REJECT_UNAUTHORIZED` | Optional | Set to `false` to skip TLS certificate validation (not recommended; defaults to `true`). |

> **Security note:** Keep credentials out of source control. The `tokens/` directory is ignored by Git so the cursor and any
> cached state remain local to your machine.

## Running the poller

1. Install dependencies if you have not already:
   ```bash
   npm install
   ```
2. Export or configure the environment variables described above.
3. Start the poller:
   ```bash
   npm run imap:poller
   ```
4. The script connects to the IMAP server, initializes its cursor (using the configured lookback window on the first run), and
   then polls continuously. Each new message found is logged and passed to `processMessage()` for custom handling.

### Resetting cursor state

- Delete `tokens/imap-poll-state.json` to reset the polling cursor (the next run will reinitialize using the configured lookback
  window).

## Extending `processMessage`

The default implementation simply logs that it was invoked. To hook in your own processing logic, edit `scripts/imap-poller.mjs`
and update the `processMessage` function to call into your application code, enqueue work, or transform the payload as needed.

## Troubleshooting

- **Authentication failures:** Double-check the username/password pair and whether the account requires an app password or
  additional security steps.
- **TLS issues:** If you see certificate validation errors when connecting to a development or self-hosted server, temporarily
  set `IMAP_TLS_REJECT_UNAUTHORIZED=false` while you correct the certificate chain.
- **No new messages detected:** Ensure you are polling the correct mailbox and, if `IMAP_REQUIRE_UNSEEN=true`, verify that the
  messages are still marked unread. Deleting `tokens/imap-poll-state.json` forces the poller to rebuild its cursor using the
  configured lookback window.
