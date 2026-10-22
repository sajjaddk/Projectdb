const { defineConfig } = require('cypress');
const { allureCypress } = require('allure-cypress/reporter');

process.loadEnvFile('.env.test'); // fake demo credentials; does not override variables already set
const port = process.env.PORT || '4000';

// The app is started by `node scripts/with-server.js` (npm run test:cy), not by this config.
module.exports = defineConfig({
  e2e: {
    baseUrl: `http://127.0.0.1:${port}`,
    setupNodeEvents(on, config) {
      allureCypress(on, config, { resultsDir: 'allure-results/cypress' });
      return config;
    },
    specPattern: 'cypress/e2e/**/*.cy.js',
    supportFile: 'cypress/support/e2e.js',
    env: {
      ADMIN_PASSWORD: process.env.ADMIN_PASSWORD,
      DISPATCHER_PASSWORD: process.env.DISPATCHER_PASSWORD,
    },
    allowCypressEnv: false, // secrets are read with cy.env(), not exposed to browser code
    video: false,
    defaultCommandTimeout: 6000,
    retries: { runMode: 1, openMode: 0 },
    reporter: 'junit',
    reporterOptions: { mochaFile: 'reports/cypress/results-[hash].xml' },
  },
});
