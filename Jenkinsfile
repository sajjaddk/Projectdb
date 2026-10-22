// Declarative pipeline for a Linux (Ubuntu) Jenkins agent. See docs/JENKINS_SETUP.md for prerequisites.
// Each parallel suite starts its OWN app instance (in-memory DB, fake credentials from .env.test)
// on a different port, runs the tests against it, and stops it again (scripts/with-server.js).
pipeline {
  agent any

  options {
    timestamps()
    timeout(time: 30, unit: 'MINUTES')
    disableConcurrentBuilds()
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }

  // Jenkins is not reachable from GitHub, so it polls for new commits every ~5 minutes.
  triggers { pollSCM('H/5 * * * *') }

  parameters {
    choice(name: 'SUITE', choices: ['all', 'unit', 'cypress', 'playwright', 'k6'], description: 'Which test suite(s) to run')
    string(name: 'K6_VUS', defaultValue: '10', description: 'k6 virtual users')
    string(name: 'K6_DURATION', defaultValue: '30s', description: 'k6 steady-state duration')
  }

  environment {
    CI = 'true'
    // Keep Playwright browsers inside the workspace so the build does not depend on the home directory
    PLAYWRIGHT_BROWSERS_PATH = "${WORKSPACE}/.playwright-browsers"
  }

  stages {
    stage('Check tools') {
      steps {
        sh '''
          node -v && npm -v
          node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 22 ? 0 : 1)" || { echo "Node 22+ required"; exit 1; }
          k6 version || echo "k6 not installed - the k6 stage will fail"
        '''
      }
    }

    stage('Install') {
      steps {
        sh 'npm ci'
        sh 'npx playwright install chromium'
        sh 'mkdir -p reports'
      }
    }

    stage('Unit tests') {
      when { expression { params.SUITE in ['all', 'unit'] } }
      steps { sh 'npm run test:unit' }
    }

    stage('E2E / API / Load') {
      parallel {
        stage('Cypress') {
          when { expression { params.SUITE in ['all', 'cypress'] } }
          environment { PORT = '4001' }
          steps { sh 'npm run test:cy' }
        }
        stage('Playwright') {
          when { expression { params.SUITE in ['all', 'playwright'] } }
          environment { PORT = '4002' }
          steps { sh 'npm run test:pw' }
        }
        stage('k6 load test') {
          when { expression { params.SUITE in ['all', 'k6'] } }
          environment {
            PORT = '4003'
            VUS = "${params.K6_VUS}"
            DURATION = "${params.K6_DURATION}"
          }
          steps {
            sh 'mkdir -p reports/k6 && node scripts/with-server.js k6 run --summary-export=reports/k6/summary.json performance/load.js'
          }
        }
      }
    }
  }

  post {
    always {
      junit allowEmptyResults: true, testResults: 'reports/**/*.xml'
      archiveArtifacts allowEmptyArchive: true, artifacts: 'reports/**, cypress/screenshots/**, test-results/**'
    }
    failure { echo 'Build failed - check the test report and archived artifacts.' }
  }
}
