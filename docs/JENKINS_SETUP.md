# Running this project on your local Jenkins

## What runs where
Jenkins checks out this repo into its workspace and runs the `Jenkinsfile`. **The app and every test run on the
Jenkins machine itself** (app on `127.0.0.1`, ports 4001-4003). GitHub only stores the code.

```
GitHub (code) -> Jenkins server: npm ci -> unit -> [ Cypress | Playwright | k6 ] each starting its own app instance
```

## One-time prerequisites on the Jenkins machine (Ubuntu example)
```bash
# Node 22+ (NodeSource example)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs

# Cypress / Playwright system libraries (Electron/Chromium need these)
sudo apt-get install -y xvfb libgtk-3-0 libnotify4 libnss3 libxss1 libasound2t64 libgbm1 libxtst6 xauth
# (Playwright can also do it: npx playwright install-deps chromium)

# k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
```
Make sure the `jenkins` user can run `node`, `npm` and `k6` (check with `sudo -u jenkins node -v`).
If you use the NodeJS Jenkins plugin instead, add `tools { nodejs 'node22' }` to the Jenkinsfile.

Required plugins: **Pipeline**, **Git**, **JUnit** (all default).

## Create the job
1. New Item -> **Pipeline** -> name `taxi-projectdb`.
2. Pipeline -> Definition: **Pipeline script from SCM** -> Git -> `https://github.com/sajjaddk/Projectdb.git`, branch `*/main`, Script Path `Jenkinsfile`.
   (Public repo: no credentials needed. Private repo: add a GitHub token under Credentials.)
3. Save -> **Build with Parameters**. The `SUITE` parameter lets you run only one suite.
4. Polling (`pollSCM`) is already defined in the Jenkinsfile; the first manual build registers it.

## Results
- **Test Result** tab: JUnit results from Playwright and Cypress.
- **Build Artifacts**: `reports/playwright/html/index.html` (open it for the Playwright report), `reports/k6/summary.json`, Cypress screenshots on failure.
- A failed k6 threshold fails the build (p95 latency, error rate).

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Node 22+ required` | Install Node 22 for the `jenkins` user (see above) |
| Cypress: `Xvfb` / shared library errors | install the apt packages above |
| Playwright: missing browser | `Install` stage runs `npx playwright install chromium`; add `--with-deps` once as root if libs are missing |
| `App did not become healthy` | port 4001-4003 already used on the machine; change `PORT` in the Jenkinsfile |
| `k6: command not found` | install k6 on the Jenkins machine |

## Using Windows as the Jenkins agent
Replace `sh` with `bat`, drop the `apt` steps and install Node 22 + k6 (winget/choco). The npm scripts work unchanged.
