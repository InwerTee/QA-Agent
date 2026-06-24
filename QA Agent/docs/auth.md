# Authentication

This document explains how to configure local Gro staging authentication for the QA Agent.

## What Goes Into Git

The repository should contain:

- Login code.
- Login workflow documentation.
- `.env.example`.
- Storage state generation logic.

The repository should not contain:

- Real `.env` files.
- Real usernames or passwords.
- `storage-state/*.json`.
- Cookies, localStorage tokens, or session tokens.

## Environment Variables

Create a local `.env` file either in the repository root or inside `QA Agent/`:

```text
QA_ADMIN_BASE_URL=
QA_ADMIN_LOGIN_URL=
QA_ADMIN_USERNAME=
QA_ADMIN_PASSWORD=
QA_ADMIN_VERIFICATION_CODE=
QA_HEADLESS=true
```

`QA Agent/src/runtime/config.ts` reads `QA Agent/.env` first and then falls back to `../.env`.

## Storage State

After a successful login, the agent writes:

```text
QA Agent/storage-state/admin.json
```

This file lets later runs reuse the logged-in Admin Site session. It is intentionally ignored by git because it may contain cookies or localStorage tokens.

## Running With Verification Code

If staging provides a fixed verification code:

```bash
QA_ADMIN_VERIFICATION_CODE=1234 npm run qa:run:r6
```

If the verification code must be entered manually, run headed:

```bash
QA_HEADLESS=false npm run qa:run:r6
```

The agent will open the browser. Enter the verification code and complete login; the resulting session will be stored locally in `storage-state/admin.json`.

## Reusing an Existing Storage State

If you already have a valid Playwright storage state file, point the agent to it:

```bash
QA_ADMIN_STORAGE_STATE=/absolute/path/to/admin.json npm run qa:run:r6
```

Do not commit that file.

## Refreshing Login

The agent reuses `storage-state/admin.json` when it is still fresh. To force login again:

```bash
QA_FORCE_RELOGIN=true npm run qa:run:r6
```

The default storage state TTL is 24 hours. Override it with:

```text
QA_STORAGE_TTL_MS=86400000
```

## Troubleshooting

If login fails:

- Confirm `QA_ADMIN_BASE_URL` and `QA_ADMIN_LOGIN_URL` point to the same staging environment.
- Confirm the account has permission to access Master Campaign.
- If the page asks for verification code, use `QA_HEADLESS=false`.
- Delete local `storage-state/admin.json` only when the session is stale or belongs to the wrong account.
