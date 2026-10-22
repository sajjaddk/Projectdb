# Guide: Automate tests for any Git project with GitHub Actions

**Goal:** every push or pull request on GitHub automatically runs your tests on a fresh machine that GitHub
provides, and shows green/red next to the commit - with no server for you to maintain.

Worked example: this repo (`Projectdb`: Node app + unit + Playwright + Cypress + k6). Sections marked *(generic)*
apply to any language.

Compare with Jenkins (`GUIDE_JENKINS_AUTOMATION.md`):

| | GitHub Actions | Jenkins |
|---|---|---|
| Where tests run | GitHub-hosted temporary VM (or your own *self-hosted runner*) | your own machine |
| Setup | one YAML file in the repo | install server, plugins, job |
| Trigger | GitHub pushes the event (no polling) | polling or webhook |
| Cost | free minutes for public repos, limited for private | free, you pay with your own hardware/time |
| Best for learning | quick, portable, industry-standard | deep CI/CD & server skills |

---

## 0. How it works

```
 git push ──► GitHub sees .github/workflows/*.yml ──► starts a fresh Ubuntu VM
                                                      1. checkout your code
                                                      2. install Node / tools
                                                      3. npm ci, start app, run tests
                                                      4. upload reports, report status on the commit/PR
                                                      VM is destroyed afterwards
```
Each run starts on a **clean machine**, so anything not in the workflow or the repo does not exist - a great way to
prove the project really works from scratch.

---

## 1. Prepare the project (*generic*)
Same rules as for Jenkins (see `GUIDE_JENKINS_AUTOMATION.md`, section 1): one command per task, lock file, tests start the
app themselves, unique test data, JUnit/HTML reports, no real secrets. Verify on a clean clone:
```bash
git clone https://github.com/<you>/<repo>.git /tmp/clean && cd /tmp/clean
npm ci && npm run test:unit && npm run test:pw && npm run test:cy && npm run test:perf
```

---

## 2. Create the workflow file

Create `.github/workflows/ci.yml` in the repo (folder names are exact), commit and push. It appears under the
repo's **Actions** tab.

### Minimal version *(generic - replace the commands)*
```yaml
name: CI
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
```

### Full version for this repo
Parallel jobs for unit, Playwright, Cypress and k6, with reports uploaded as artifacts.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  workflow_dispatch:            # adds a "Run workflow" button
  schedule:
    - cron: '0 2 * * *'         # nightly at 02:00 UTC

concurrency:                    # cancel older runs of the same branch
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read                # least privilege for the built-in token

jobs:
  unit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test:unit

  playwright:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm run test:pw
      - uses: actions/upload-artifact@v4
        if: always()                      # upload even when tests failed
        with:
          name: playwright-report
          path: |
            reports/playwright
            allure-results/playwright
          retention-days: 14

  cypress:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run test:cy              # Cypress binary + system libs are available on ubuntu-latest
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: cypress-results
          path: |
            reports/cypress
            cypress/screenshots
            allure-results/cypress
          if-no-files-found: ignore

  k6:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - uses: grafana/setup-k6-action@v1
      - run: npm ci
      - run: npm run test:perf
        env:
          VUS: 10
          DURATION: 30s
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: k6-results
          path: reports/k6
```
> Pin versions (`@v4`) as shown. For stricter supply-chain safety you can pin to a commit SHA.
> I have not run this exact file on GitHub; if a step fails, read the step's log - messages are usually clear.

Each job runs on its own VM, so all four use port 4000 safely (unlike Jenkins parallel stages on one machine).

---

## 3. Anatomy of a workflow

| Key | Meaning |
|---|---|
| `on:` | events that start it: `push`, `pull_request`, `schedule` (cron), `workflow_dispatch` (manual button) |
| `jobs:` | independent units; they run **in parallel** unless you add `needs:` |
| `runs-on:` | VM type: `ubuntu-latest`, `windows-latest`, `macos-latest` |
| `steps:` | ordered list; `uses:` = reusable action, `run:` = shell command |
| `needs: [unit]` | wait for another job (build -> test -> deploy chains) |
| `if: always()` | run a step even when earlier steps failed (reports!) |
| `env:` | environment variables (workflow, job or step level) |
| `strategy.matrix` | run the same job for several values (Node 20/22, chromium/firefox) |
| `timeout-minutes` | kill hung jobs |
| `concurrency` | cancel outdated runs |

Common actions: `actions/checkout`, `actions/setup-node` (also `setup-python`, `setup-java`), `actions/upload-artifact`,
`actions/cache`, `cypress-io/github-action`, `grafana/setup-k6-action`.

### Matrix example (test on several browsers)
```yaml
  playwright:
    strategy:
      fail-fast: false
      matrix:
        browser: [chromium, firefox]
    steps:
      - ...
      - run: npx playwright install --with-deps ${{ matrix.browser }}
      - run: npm run test:pw -- --project=ui-${{ matrix.browser }}   # needs matching projects in playwright.config.js
```

---

## 4. Secrets and variables

Never commit real secrets.
1. Repo -> **Settings -> Secrets and variables -> Actions -> New repository secret** (e.g. `STAGING_PASSWORD`).
2. Use them:
```yaml
      - run: npm run test:e2e
        env:
          ADMIN_PASSWORD: ${{ secrets.STAGING_PASSWORD }}
```
Secrets are masked in logs and are **not** available to workflows from forked pull requests.
Non-secret settings (URLs) go in **Variables** and are read as `${{ vars.BASE_URL }}`.

This repo's `.env.test` only holds fake credentials for an in-memory database, so it can stay in Git.

---

## 5. Seeing results

- **Actions tab** -> pick a run -> each job -> expand a step for logs. A red X shows the failing step.
- Commit page and PRs show the check status (green tick / red cross).
- **Artifacts** (bottom of the run summary) hold reports: download `playwright-report`, open `reports/playwright/html/index.html`.
- Job summary: write Markdown to `$GITHUB_STEP_SUMMARY` to show a table on the run page.
- Add a status badge to the README:
  `![CI](https://github.com/<you>/<repo>/actions/workflows/ci.yml/badge.svg)`

### Publish an HTML/Allure report on GitHub Pages (optional)
Generate the report in a job (`npx allure-commandline generate ...`), then use `actions/upload-pages-artifact` +
`actions/deploy-pages` (needs *Settings -> Pages -> Source: GitHub Actions* and `permissions: pages: write, id-token: write`).

---

## 6. Make tests a gate for merging (branch protection)

Repo -> **Settings -> Branches -> Add rule** for `main`:
- Require a pull request before merging
- **Require status checks to pass** -> select `unit`, `playwright`, `cypress`, `k6`
- (optional) Require branches to be up to date

Now broken code cannot reach `main`. Workflow: create a branch -> push -> open PR -> Actions run -> merge when green.

---

## 7. Test against a deployed app instead of starting one
```yaml
      - run: npx playwright test
        env:
          BASE_URL: ${{ vars.STAGING_URL }}      # your configs must read BASE_URL
```
GitHub-hosted runners are on the internet and **cannot reach `10.0.0.56`** (a private address). To test your home
Linux server's app, use a **self-hosted runner** (next section).

---

## 8. Self-hosted runner: run Actions on your own Linux server
Use it when tests must reach private machines, or you want unlimited minutes.
1. Repo -> **Settings -> Actions -> Runners -> New self-hosted runner** -> Linux. GitHub shows the exact commands
   (download, `./config.sh --url ... --token ...`, `./run.sh`).
2. Install it as a service: `sudo ./svc.sh install && sudo ./svc.sh start`.
3. Install Node/k6/browser libraries on that machine (see Jenkins guide section 3).
4. In the workflow: `runs-on: self-hosted`.

**Security:** only use self-hosted runners on **private** repos or with strict settings. A public repo lets strangers
open pull requests that run code on your machine.

---

## 9. Other stacks (*generic*)
```yaml
# Java
- uses: actions/setup-java@v4
  with: { distribution: temurin, java-version: 21, cache: maven }
- run: mvn -B test
# Python
- uses: actions/setup-python@v5
  with: { python-version: '3.12', cache: pip }
- run: pip install -r requirements.txt && pytest --junitxml=reports/pytest.xml
# .NET
- uses: actions/setup-dotnet@v4
  with: { dotnet-version: '8.0.x' }
- run: dotnet test
```

---

## 10. Checklist for a new project
- [ ] Clean clone + one command runs all tests
- [ ] `.github/workflows/ci.yml` committed to the default branch
- [ ] Workflow triggers: `push`, `pull_request`, optional `workflow_dispatch` and nightly `schedule`
- [ ] Reports uploaded with `if: always()`
- [ ] Secrets stored in repo Secrets, not in files
- [ ] First run green (Actions tab); badge in README
- [ ] Break a test on purpose in a PR -> red check -> fix -> green
- [ ] Branch protection requires the checks

## 11. Troubleshooting
| Symptom | Fix |
|---|---|
| Workflow not listed in Actions | file must be at `.github/workflows/*.yml` on the default branch; check YAML indentation |
| `Error: Process completed with exit code 1` | open that step's log; it is the real test/command failure |
| Works locally, fails in Actions | different Node version, tool missing on clean VM, test depends on local data/state |
| Playwright can't launch browser | add `npx playwright install --with-deps chromium` |
| `npm ci` fails: lock file mismatch | run `npm install` locally and commit the updated `package-lock.json` |
| Secret is empty | secrets are not passed to workflows from forks; check the exact name |
| Job hangs | add `timeout-minutes`; check the app actually started (health check) |
| Cannot reach private server | hosted runners can't see your LAN; use a self-hosted runner |
| Billing/minutes exhausted (private repos) | reduce triggers (`pull_request` only + nightly), cache dependencies |

Tip: while editing the workflow, use `workflow_dispatch` to rerun quickly, and install `act`
(https://github.com/nektos/act) if you want to try workflows locally.
