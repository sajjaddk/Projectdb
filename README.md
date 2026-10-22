# Taxi Manager (Projectdb)

A small but complete web project for practising test automation and CI: a **taxi company back-office** with login,
a real database, roles, and a full set of tests (unit, API, UI, security, load) that run in **Jenkins**.
Everything is demo code with fake data - no employer code or data.

## Features
| Area | What you can do | Who |
|---|---|---|
| Login | Username/password sign-in, session cookie, sign-out, lockout after 5 failed attempts | everyone |
| Drivers | Create, edit (activate/deactivate), delete | admin (dispatcher: read-only) |
| Cars | Register car (plate, make, model, year, seats), assign one driver, set maintenance, delete | admin (dispatcher: read-only) |
| Bookings | Create booking, assign car, start, complete, cancel. Fare = $3.00 + $1.50/km (server-side) | admin + dispatcher |
| Users | Add admin/dispatcher accounts | admin |

Booking life-cycle: `requested -> assigned -> in_progress -> completed` (cancel from `requested` / `assigned`).
Business rules worth testing: only available cars with an **active driver** can be assigned; a car can't be on two
trips at once; a driver can be on only one car; a car with an active booking can't be deleted.

## Stack
Node 22+ (tested on 24), Express 5, SQLite (built-in `node:sqlite`, no DB server to install), plain HTML/JS front end.
Only **one** runtime dependency (`express`).

## Quick start
```bash
npm install
npx playwright install chromium
npm run start:demo        # http://127.0.0.1:4000   (in-memory DB, seeded demo data)
```
Demo logins (fake, from `.env.test`): `admin` / `Admin-Demo-Pass-12345`, `dispatcher` / `Dispatch-Demo-Pass-12345`.

For a persistent database copy `.env.example` to `.env`, set `ADMIN_PASSWORD` and `DISPATCHER_PASSWORD`, then `npm start`
(data is stored in `data/taxi.db`).

## Tests
| Command | What it runs |
|---|---|
| `npm run test:unit` | 12 unit tests (validation, fare, password hashing) |
| `npm run test:pw` | Playwright: 34 API tests + 13 UI tests |
| `npm run test:cy` | Cypress: 17 UI/E2E tests (POM, custom commands, `cy.session`) |
| `npm run test:perf` | k6 load test with thresholds (`VUS=20 DURATION=60s npm run test:perf`) |
| `npm run cy:open` | Cypress interactive runner |
| `npx playwright test --ui` | needs the app running (`npm run start:demo`) |

`test:pw`, `test:cy` and `test:perf` start their own app instance, wait for `/api/health`, run, then stop it
(`scripts/with-server.js`). Set `PORT=4005` to use another port.

## Jenkins
The `Jenkinsfile` installs, runs unit tests, then Cypress / Playwright / k6 **in parallel**, each against its own app
instance on the Jenkins machine, and publishes JUnit results and artifacts. Setup steps: [docs/JENKINS_SETUP.md](docs/JENKINS_SETUP.md).

## Project layout
```
server.js            start-up (config, seeding)
src/                 app.js (routes), auth.js (sessions/CSRF/RBAC), db.js (schema), validate.js, passwords.js, seed.js
public/              index.html, app.js, style.css  (no inline scripts; strict CSP)
tests/unit/          node:test unit tests
playwright/          api/ and e2e/ specs + helpers
cypress/             e2e/ specs, support/ (commands, page objects)
performance/load.js  k6 script
scripts/with-server.js  start app -> run command -> stop app
Jenkinsfile, docs/
```

## Security notes (practice-project level)
- Passwords hashed with scrypt + per-password salt; session ids are random 256-bit values stored only as SHA-256 hashes.
- Cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` when `COOKIE_SECURE=true`); idle 30 min / absolute 8 h timeout.
- CSRF token required on every state-changing request; server-side role checks on every route.
- All input validated against an allow-list on the server; parameterised SQL only; the UI renders data with `textContent`.
- Strict CSP, `nosniff`, `X-Frame-Options: DENY`; generic error messages; login lockout; JSON request logs for auth events.
- Listens on `127.0.0.1` by default. **Authentication is local username/password** (not SSO) because this is a standalone practice app.
- Known limits: login lockout is in-memory and per process, no HTTPS (put a TLS reverse proxy in front for anything beyond localhost), no general rate limiting.
- The credentials in `.env.test` are fake and only protect an in-memory database. Never put real secrets in the repo.
