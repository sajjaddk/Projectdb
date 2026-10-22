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
- **Allure Report** link (see the Allure section below).
- **Test Result** tab: JUnit results from Cypress, Playwright and k6 (thresholds and checks).
- **Playwright Report** link in the job menu (needs the HTML Publisher plugin; if the page is blank, see below).
- **Build Artifacts**: `reports/playwright/html/index.html` (open it for the Playwright report), `reports/k6/junit.xml` + `summary.json`, Cypress screenshots on failure.
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

## Blank Playwright Report page?
Jenkins blocks scripts in published HTML by default. Either download `index.html` from the build artifacts and open it
locally, or relax the policy once in **Manage Jenkins -> Script Console** (resets on Jenkins restart; fine for a private practice box):
```groovy
System.setProperty("hudson.model.DirectoryBrowserSupport.CSP", "sandbox allow-scripts; default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:")
```

## Allure report (one combined report for Playwright + Cypress)
Playwright and Cypress write raw results to `allure-results/playwright` and `allure-results/cypress`; the Jenkinsfile
merges them into one report.

One-time Jenkins setup:
1. **Manage Jenkins -> Plugins -> Available plugins** -> install **Allure** -> restart Jenkins when idle.
2. **Manage Jenkins -> Tools -> Allure Commandline installations -> Add Allure Commandline**: name `allure`,
   tick *Install automatically* (Maven Central), pick a 2.x version. Needs Java on the Jenkins machine (Jenkins already has it).
3. Run the job. An **Allure Report** link appears in the job menu and on each build.

Locally (optional): `npx allure-commandline generate allure-results/playwright allure-results/cypress -o allure-report --clean`
then `npx allure-commandline open allure-report`.
