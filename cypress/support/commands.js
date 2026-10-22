const uid = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const digits = (n) => String(Math.floor(Math.random() * 10 ** n)).padStart(n, '0');

Cypress.Commands.add('uid', uid);

// Test data factories (unique values so tests never collide)
Cypress.Commands.add('newDriver', (over = {}) => cy.wrap({
  full_name: `CY Driver ${uid()}`, phone: `+1 555 ${digits(4)}`, license_number: `CY-${uid()}${digits(3)}`, ...over,
}));
Cypress.Commands.add('newCar', (over = {}) => cy.wrap({
  plate: `CY-${uid()}`, make: 'Toyota', model: 'Prius', year: 2023, seats: 4, ...over,
}));

// Passwords come from cy.env() (not Cypress.env) so they are not exposed to the app's browser code.
const creds = (role) => {
  const key = role === 'admin' ? 'ADMIN_PASSWORD' : 'DISPATCHER_PASSWORD';
  return cy.env([key]).then((env) => ({ username: role, password: env[key] }));
};

/** Fast login through the API; the session is cached per role with cy.session. */
Cypress.Commands.add('loginAs', (role) => {
  cy.session(['user', role], () => {
    creds(role).then((c) => cy.request('POST', '/api/auth/login', c));
  }, {
    validate() { cy.request('/api/auth/me').its('status').should('eq', 200); },
  });
});

/** Slow login through the UI form (used by the login tests themselves). */
Cypress.Commands.add('loginViaUi', (role) => {
  cy.visit('/');
  creds(role).then((c) => {
    cy.get('[data-testid=username]').type(c.username);
    cy.get('[data-testid=password]').type(c.password, { log: false });
    cy.get('[data-testid=login-btn]').click();
  });
});

/** Authenticated API call helper: logs in as the given role, then runs the request with the CSRF token. */
Cypress.Commands.add('apiAs', (role, method, url, body) => {
  return creds(role).then((c) => cy.request('POST', '/api/auth/login', c)).then(({ body: { csrfToken } }) => {
    return cy.request({ method, url, body, headers: { 'X-CSRF-Token': csrfToken }, failOnStatusCode: false });
  });
});

/** Creates a driver + a car with that driver through the API. Yields { driver, car }. */
Cypress.Commands.add('seedCarWithDriver', () => {
  return cy.newDriver().then((d) => cy.apiAs('admin', 'POST', '/api/drivers', d).then((dr) => {
    return cy.newCar({ driver_id: dr.body.id }).then((c) => cy.apiAs('admin', 'POST', '/api/cars', c).then((cr) => ({
      driver: dr.body, car: cr.body,
    })));
  }));
});
