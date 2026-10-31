# SmartODL

SmartODL is a self-hosted learning platform with courses, quizzes, coding challenges, contests, certificates, subscriptions, and optional live-proctoring features. The repository contains a React/Vite frontend, an Express/MySQL API, and a separate worker for code execution.

> **Current repository status:** The project is actively developed. Before using it with real students or payments, review the deployment/security notes below and test the complete setup against a fresh database.

## Requirements

- Node.js **20 or newer** and npm.
- MySQL or MariaDB. Local Windows users commonly use XAMPP.
- A modern browser.
- A Linux/POSIX host for the local judge in production. Do not expose the Windows judge worker to untrusted users.

## Local development

### Windows

1. Install and start MySQL/MariaDB. Create a database user with permissions to create the local database/schema, or use a dedicated local development account.
2. Run `Setup.bat` (or `start.bat`, which delegates to it). The setup script installs the locked dependencies and creates local-only environment files with generated secrets. It asks for database connection details.
3. Keep the database, API, judge, and frontend service windows open. The frontend is at <http://localhost:5173>; the API health endpoint is <http://localhost:5000/api/health>.
4. Create the first owner account from an interactive terminal in `backend`:
   ```bat
   npm run owner:bootstrap
   ```
   This prompts for the name, email, and a strong password. There is no built-in shared admin password.

`Setup.bat` is the supported launcher. It only manages SmartODL service windows; do not use an old/global `taskkill node.exe` workflow because it can stop unrelated Node applications.

#### Open the development site from another laptop on your private LAN

The Vite dev server intentionally binds to this computer only by default. When `Setup.bat` asks whether another laptop should connect on the trusted private Wi-Fi/LAN, answer `Y`; after startup it prints one or more shareable `http://<private-IPv4>:5173` links. The same behavior can be preselected from Command Prompt:

```bat
set VITE_HOST=0.0.0.0
Setup.bat
```

For manual startup, run `npm run dev:lan` from `frontend`. From the repository root, the convenience command `npm run dev:lan` delegates to the frontend.

If the link does not load, run `ipconfig` on the host and use its active Wi-Fi/Ethernet **IPv4 Address** (for example `192.168.1.20`) in `http://192.168.1.20:5173`. The second laptop must be on the same trusted network; do not use `localhost` there because that means the second laptop itself. Allow Node.js/Vite on **Private networks only** in Windows Firewall, or add an inbound TCP rule for port `5173` scoped to the Private profile. Guest Wi-Fi/client isolation can block device-to-device traffic even when both devices have internet.

The Express API binds to `127.0.0.1` by default; the Vite proxy reaches it locally, so do not open port `5000` to the LAN for this setup. If you have an older `backend/.env` containing `HOST=0.0.0.0`, change it to `HOST=127.0.0.1` and restart the API. Only set `HOST=0.0.0.0` when direct API access from other machines is intentionally required on a trusted private network. Never port-forward the development server or use it on a public/untrusted network.

### Linux/macOS development

Install the three services and configure local environment files:

```sh
cd frontend && npm ci
cd ../backend && npm ci
cd judge-service && npm ci
```

Copy `backend/.env.example` to `backend/.env` and `backend/judge-service/.env.example` to `backend/judge-service/.env`. Use unique random JWT and judge tokens; set matching `JUDGE_SERVICE_TOKEN` values in both files. For a local-only judge, point the API at `http://127.0.0.1:2358`. Configure `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME` for your local database. Start the judge, API, and frontend in separate terminals with `npm start`, `npm start`, and `npm run dev` respectively (from each service directory). To intentionally share the frontend on a trusted private LAN, use `cd frontend && npm run dev:lan`; Vite should print a `Network` URL. Do not expose the API, judge, or dev server to a public/untrusted network.

The local setup's optional automatic schema import is destructive on a missing/empty schema: the bundled SQL file drops and recreates tables. Never point `SMARTODL_ALLOW_DB_AUTOSETUP=1` at a database containing data you need.

## Database setup

The bundled MySQL/MariaDB dump is `database/education_platform.sql`; its database name is `education_platform`, matching the default `DB_NAME`. The TiDB/managed-database variant is `database/education_platform.tidb.sql` and must be run inside the database selected in the provider console.

For a manual MySQL/MariaDB import, create/select the `education_platform` database and import the SQL file. On Windows, `database/IMPORT-DATABASE.bat` imports the bundled schema; **it drops and recreates tables**, so back up first if this is not a fresh install. The app also checks for an imported `settings` table at startup and provides a diagnostic if the schema is missing.

If Feature Control returns `Unknown setting key: proctor_recording_enabled`, the API is connected to a database where its feature-flag migration has not run (often because the backend files are stale, `SMARTODL_SKIP_MIGRATIONS=1`, or the API uses a different `DB_NAME`). Do **not** re-import the destructive schema. From `backend`, run `npm run migrate` with a database account allowed to create/update settings rows, then restart the API. For a safe manual repair, select the database configured in `backend/.env` and execute `database/patch-proctor-integrity-settings.sql`; its `INSERT IGNORE` preserves existing admin values. `backend/.env.example` documents why these switches belong in the database and how migration skipping affects them.

Production deployments should import the schema as a controlled deployment step, then run `cd backend && npm run migrate` using an account permitted to apply migrations. Run the API with a separate least-privilege application database user. Do not use a MySQL root account for the production API.

## Production deployment and security

1. Build the frontend with `cd frontend && npm ci && npm run build`, then serve `frontend/dist` over HTTPS using a web server or hosting platform.
2. Configure `backend/.env` from `backend/.env.example`. Set `NODE_ENV=production`, an exact HTTPS `CLIENT_URL`, a specific `TRUST_PROXY` hop count, database TLS settings when using a remote database, and independent random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values.
3. Set `JUDGE_MODE=judge0` with a managed/private Judge0 endpoint, or deploy the isolated worker using `Dockerfile.judge`. The local production worker requires Linux isolation and the hardened `sodl-exec`/`sodl-clean` wrappers. Restrict worker network access to the API. Never expose an unsandboxed Windows/dev worker to the public internet.
4. Configure a real payment gateway before taking payments. Demo payments are development-only. For UPI direct payments, keep auto-approval off unless payment statements are reconciled independently.
5. Set `MAIL_MODE` and SMTP values if password reset and email features are required. Keep credentials out of source control and logs.
6. Use Redis for shared rate-limit state when running multiple API instances; the in-memory fallback is per-process.
7. Back up the database and uploads, monitor logs, and test account permissions, checkout verification, backups, and restore procedures before launch.

The production environment validator refuses common unsafe defaults, demo payments, weak secrets, and an unsafe trust-proxy setting. Read `backend/judge-service/README.md` for worker isolation and sudo-wrapper setup.

## Useful commands

From the repository root:

```sh
npm run install:all
npm run build
```

Service checks:

```sh
cd backend && npm test && npm run env:check
cd frontend && npm test && npm run build
cd backend/judge-service && npm run check
```

To create the first owner, run `npm run owner:bootstrap` in `backend` from a real interactive terminal.

## Repository layout

- `frontend/` — React 18 application, Vite build and frontend tests.
- `backend/` — Express API, MySQL schema/migrations, auth, payments, and backend unit tests.
- `backend/judge-service/` — separate sandboxed code execution service.
- `database/` — MySQL/MariaDB dump, TiDB-compatible dump, and import tools.
- `Dockerfile.judge` — hardened Linux judge-worker image.

## License

See [`LICENSE`](LICENSE).
