# Guide: Automate tests for any Git project with Jenkins

**Goal:** you have a project in GitHub. You write tests. Every time code is pushed, Jenkins pulls the code, builds it,
runs all tests and shows you the results - with no manual work.

Worked example throughout: this repo (`Projectdb`: Node app + Cypress + Playwright + k6). Everything marked
*(generic)* applies to any language.

---

## 0. The big picture

```
 you push code ──► GitHub ◄── Jenkins asks "anything new?" (polling) or GitHub calls Jenkins (webhook)
                                 │
                                 ▼
                    Jenkins machine (the "agent")
                    1. clone the repo into a workspace
                    2. install dependencies
                    3. start the app (if the tests need one)
                    4. run tests (unit / API / UI / load)
                    5. publish reports, mark build green or red
```

Key idea: **tests always run on the Jenkins machine**, never "in GitHub". GitHub only stores code. So the Jenkins
machine must have everything the tests need (language runtime, browsers, tools) - exactly like "machine A" when you
run tests by hand.

---

## 1. Make your project automation-friendly (do this first, *generic*)

A pipeline can only automate what already works from a clean checkout with **one command**. Before touching Jenkins:

| Rule | Why | Projectdb example |
|---|---|---|
| Every task is one command | The pipeline just calls it | `npm run test:unit`, `npm run test:pw`, `npm run test:cy`, `npm run test:perf` |
| Dependencies are pinned in a lock file | Same versions every run | `package-lock.json` + `npm ci` |
| Tests start/stop the app themselves | No manual steps, no leftover processes | `scripts/with-server.js` |
| Port and settings come from environment variables | Parallel suites can use different ports | `PORT=4001` |
| Test data is created by the test, unique per run | Tests don't depend on each other or on old data | random plates / license numbers |
| Tests use a throw-away database | Clean state every run | `DB_FILE=:memory:` |
| No real secrets in the repo | Public repos are public | fake demo values in `.env.test`, real ones in Jenkins Credentials |
| Tests exit with non-zero code on failure | That is how Jenkins knows it failed | default for all runners |
| Tests write machine-readable results (JUnit XML) | Jenkins can show them | `reports/**/*.xml` |

**Test it yourself on a clean clone** (this simulates the Jenkins machine):
```bash
git clone https://github.com/<you>/<repo>.git /tmp/clean && cd /tmp/clean
npm ci && npm run test:unit && npm run test:pw && npm run test:cy && npm run test:perf
```
If this does not work on a clean clone, Jenkins will not work either. Fix it here first.

---

## 2. What to test and with which tool (*generic*)

Use the testing pyramid: many fast tests at the bottom, few slow ones at the top.

| Level | Tool (this repo) | What it checks | Speed |
|---|---|---|---|
| Unit | `node:test` (JUnit/pytest/etc. elsewhere) | one function: validation, fare calculation | ms |
| API | Playwright `request` | endpoints: status codes, validation, permissions | fast |
| UI / E2E | Cypress, Playwright | real browser: login, forms, full user journeys | slow |
| Load | k6 | response time and errors under many users | slow |
| Security checks | inside API/UI tests | no access without login, wrong role = 403, XSS/SQL injection rejected | fast |

Starting a new project, write tests in this order: **unit -> API -> a few UI journeys -> one load script**.

Tips that prevent flaky tests:
- Use stable selectors: `data-testid="..."`, not CSS classes or text that changes.
- Never `sleep()`; wait for a condition (`expect(...).toBeVisible()`, Cypress retries automatically).
- Create data through the API (fast), check it through the UI (what the user sees).
- Make every test independent: it creates what it needs, never relies on another test having run.

---

## 3. Install Jenkins (Ubuntu, one time)

```bash
# Java (Jenkins needs it)
sudo apt-get update && sudo apt-get install -y fontconfig openjdk-17-jre

# Jenkins LTS from the official repository
sudo wget -O /usr/share/keyrings/jenkins-keyring.asc https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key
echo "deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] https://pkg.jenkins.io/debian-stable binary/" \
  | sudo tee /etc/apt/sources.list.d/jenkins.list > /dev/null
sudo apt-get update && sudo apt-get install -y jenkins
sudo systemctl enable --now jenkins

# first-login password
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```
Open `http://<server-ip>:8080`, paste the password, choose **Install suggested plugins**, create your admin user.
(If `ufw` is on: `sudo ufw allow 8080/tcp`.)

> If the official steps change, follow https://www.jenkins.io/doc/book/installing/linux/ - it is the source of truth.

### Install what your *tests* need on the same machine
Jenkins runs jobs as the OS user **`jenkins`**. Everything must work for that user.
```bash
# Node 22 (for this repo)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs
# Cypress / Chromium system libraries
sudo apt-get install -y xvfb libgtk-3-0 libnotify4 libnss3 libxss1 libasound2t64 libgbm1 libxtst6 xauth
# k6 -> https://grafana.com/docs/k6/latest/set-up/install-k6/

# verify AS THE JENKINS USER (this is the #1 source of "works for me, fails in Jenkins")
sudo -u jenkins node -v
sudo -u jenkins npm -v
sudo -u jenkins k6 version
```
Other stacks: Java project -> `openjdk` + Maven/Gradle; Python -> `python3 python3-venv`; .NET -> dotnet SDK. Same idea.

### Plugins (Manage Jenkins -> Plugins -> Available)
| Plugin | Needed for |
|---|---|
| Pipeline, Git, JUnit | installed by default - Jenkinsfile, checkout, test results |
| HTML Publisher | "Playwright Report" link |
| Allure | combined Allure report (+ Tools -> Allure Commandline -> *Install automatically*) |
| GitHub (optional) | webhook trigger, commit status |

---

## 4. Write the Jenkinsfile (pipeline as code)

Put a file named `Jenkinsfile` in the repo root. Jenkins reads it from Git, so the pipeline is versioned with the code.
Smallest useful version *(generic - replace the commands)*:

```groovy
pipeline {
  agent any
  triggers { pollSCM('H/5 * * * *') }          // check GitHub every ~5 min
  stages {
    stage('Install') { steps { sh 'npm ci' } }
    stage('Test')    { steps { sh 'npm test' } }
  }
  post {
    always { junit allowEmptyResults: true, testResults: 'reports/**/*.xml' }
  }
}
```

### Anatomy (and the full version in this repo's `Jenkinsfile`)
| Block | Meaning |
|---|---|
| `agent any` | run on any machine Jenkins controls (here: the same machine) |
| `options { timeout(...), disableConcurrentBuilds() }` | stop hung builds; avoid two builds fighting over ports |
| `triggers { pollSCM(...) }` | how a build starts automatically |
| `parameters { choice(...) }` | "Build with Parameters": run only one suite, set k6 users, etc. |
| `environment { PORT = '4001' }` | environment variables for commands (can be set per stage) |
| `stages { stage('x') { steps { sh '...' } } }` | the ordered steps |
| `parallel { stage('A') {...} stage('B') {...} }` | run stages at the same time (use different ports!) |
| `when { expression { params.SUITE == 'all' } }` | run a stage only conditionally |
| `post { always {...} failure {...} }` | things to do at the end, even when tests failed |

Rules that save hours:
1. **One command per stage, defined in `package.json`** (not long shell scripts inside the Jenkinsfile).
2. **Parallel stages must not share ports or files.** Here Cypress=4001, Playwright=4002, k6=4003.
3. **Publish reports in `post { always {...} }`** - you need them most when the build is red.
4. Use `sh` on Linux agents, `bat` on Windows agents.

---

## 5. Create the job in Jenkins

1. **Dashboard -> New Item** -> name (e.g. `taxi-projectdb`) -> **Pipeline** -> OK.
2. **Pipeline** section:
   - Definition: **Pipeline script from SCM**
   - SCM: **Git**
   - Repository URL: `https://github.com/<you>/<repo>.git` (public: no credentials; private: see section 8)
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
3. Save -> **Build Now**.
4. Open the build -> **Console Output** (live log) or **Pipeline Overview** (stage view).

After the first build, `pollSCM` from the Jenkinsfile is registered; Jenkins now checks GitHub every ~5 minutes and
builds only when there is a new commit.

### Multiple branches / pull requests
Use **New Item -> Multibranch Pipeline** instead. Jenkins discovers every branch (and PR) that has a Jenkinsfile and
creates a job for each automatically.

---

## 6. Triggers: how a build starts

| Trigger | How | When to use |
|---|---|---|
| Manual | Build Now | experiments |
| Polling | `pollSCM('H/5 * * * *')` | **home/local Jenkins** - GitHub can't reach you, so Jenkins asks |
| Schedule | `cron('H 2 * * *')` | nightly full regression / load test |
| Webhook | GitHub calls `http://<jenkins>/github-webhook/` | instant builds; Jenkins must be reachable from the internet (public server, or a tunnel such as Cloudflare Tunnel/ngrok) |

`H` means "a hash-based minute", which spreads load; `H/5 * * * *` = every 5 minutes.

---

## 7. Reports (so a red build tells you *why*)

| Report | Produced by | Where in Jenkins |
|---|---|---|
| Test counts / failures | JUnit XML (`reports/**/*.xml`) via the `junit` step | build page -> **Tests** |
| Playwright HTML report | `reports/playwright/html` via `publishHTML` | **Playwright Report** link |
| Allure | `allure-results/*` via the `allure` step | **Allure Report** link |
| k6 | `handleSummary` writes `reports/k6/junit.xml` + `summary.json` | **Tests** page + artifacts |
| Screenshots/videos/traces | Cypress/Playwright on failure | build -> **Build Artifacts** (`archiveArtifacts`) |

How to add reporting to a new project: configure each test tool to write JUnit XML into `reports/`, add one `junit`
line in `post { always }`, then add HTML/Allure later.

Blank HTML report in Jenkins? Jenkins blocks scripts in published HTML by default. See `docs/JENKINS_SETUP.md`
("Blank Playwright Report page?").

---

## 8. Secrets and private repos

Never put passwords/tokens in the repo or Jenkinsfile.
1. **Manage Jenkins -> Credentials -> (global) -> Add Credentials**
   - *Username with password* or *Secret text* (e.g. GitHub token, API key), give it an ID like `github-token`.
2. Use it in the pipeline:
```groovy
withCredentials([string(credentialsId: 'api-key', variable: 'API_KEY')]) {
  sh 'npm run test:e2e'          // API_KEY is available as an env var; Jenkins masks it in logs
}
```
3. Private repo: in the job's SCM section choose your credentials in the **Credentials** dropdown (GitHub
   personal access token with `repo` read scope).

This repo's demo passwords in `.env.test` are fake and protect only an in-memory database - that is the only reason
they are allowed in Git.

---

## 9. Typical pipeline for a **web app + API** (recipe, *generic*)

1. `Check tools` - print versions, fail early if Node/k6 is missing.
2. `Install` - `npm ci` (+ `npx playwright install chromium`).
3. `Lint / unit` - fastest feedback first.
4. `Parallel`: API tests | UI tests | load test - each starts its own app on its own port.
5. `post always` - JUnit, HTML/Allure reports, archive screenshots.
6. (Optional) `Deploy` stage only on `main` after everything is green.

**Testing an app that is already deployed somewhere?** Skip "start the app"; pass its address as an environment
variable (`BASE_URL=http://10.0.0.56:4000`) and point Cypress `baseUrl` / Playwright `use.baseURL` / k6 `BASE_URL` at it.

### Other stacks
| Stack | Install | Test command | JUnit output |
|---|---|---|---|
| Java + Maven | `mvn -B -DskipTests package` | `mvn -B test` | `target/surefire-reports/*.xml` |
| Python | `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt` | `.venv/bin/pytest --junitxml=reports/pytest.xml` | `reports/pytest.xml` |
| .NET | `dotnet restore` | `dotnet test --logger "junit;LogFilePath=reports/dotnet.xml"` | `reports/dotnet.xml` |

---

## 10. Checklist for a brand-new project

- [ ] Clean clone + one command runs all tests locally
- [ ] `package.json` (or equivalent) has `test:unit`, `test:api`, `test:ui`, `test:perf` scripts
- [ ] Tests write JUnit XML to `reports/`
- [ ] `.gitignore` excludes `node_modules`, `reports`, `.env`, screenshots
- [ ] Jenkins machine: runtime + browsers + k6 installed **and verified with `sudo -u jenkins`**
- [ ] `Jenkinsfile` in repo root, Install + Test stages, `junit` in `post always`
- [ ] Jenkins job created (Pipeline from SCM), first build green
- [ ] Trigger (polling) works: push a small change, see a build start within ~5 minutes
- [ ] Break a test on purpose -> build turns red and the report shows why -> revert
- [ ] Secrets only in Jenkins Credentials

---

## 11. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| `command not found: node/k6/npm` | not installed for the `jenkins` user. Check `sudo -u jenkins which node` |
| Works locally, fails in Jenkins | different Node version, missing browser libs, a test relies on your local data or a running app |
| `EADDRINUSE` / app did not start | two stages use the same port, or an old app still runs. Use unique `PORT` per parallel stage |
| Cypress: `Xvfb` / `libgtk` errors | install the apt packages in section 3 |
| Playwright: browser not found | `npx playwright install chromium` in the pipeline; `--with-deps` once as root |
| Build never starts on push | polling needs the first manual build; check **Git Polling Log** in the job menu |
| `Permission denied` in workspace | something ran as root once; `sudo chown -R jenkins:jenkins /var/lib/jenkins/workspace` |
| Flaky UI test (passes on rerun) | add a proper wait on a condition, use unique test data, reduce parallel workers |
| Report link missing | plugin not installed (HTML Publisher / Allure) |
| Pipeline syntax error | use **Pipeline Syntax** (job menu) snippet generator; check the first lines of Console Output |

Debug approach: read **Console Output** from the **first red line upward**; reproduce the failing command by hand as
the `jenkins` user (`sudo -u jenkins -H bash -lc 'cd /var/lib/jenkins/workspace/<job> && npm run test:pw'`).

---

## 12. Next steps to grow
- Multibranch pipeline + PR builds; require green builds before merge.
- Nightly job with the long k6 run (`cron`).
- Deploy stage (copy to the Linux server, `systemctl restart`), smoke test after deploy.
- Static analysis / dependency scan stage (`npm audit`, SonarQube, Mend).
- Jenkins agents on other machines (Windows/Mac/browsers matrix).
