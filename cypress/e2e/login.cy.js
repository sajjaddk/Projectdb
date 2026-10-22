describe('Login', () => {
  it('shows the login form when logged out', () => {
    cy.visit('/');
    cy.get('[data-testid=login-btn]').should('be.visible');
    cy.get('[data-testid=password]').should('have.attr', 'type', 'password');
  });

  it('rejects invalid credentials with a generic message', () => {
    cy.visit('/');
    cy.get('[data-testid=username]').type('admin');
    cy.get('[data-testid=password]').type('wrong-password-1');
    cy.get('[data-testid=login-btn]').click();
    cy.get('[data-testid=message]').should('have.text', 'Invalid username or password');
    cy.get('[data-testid=login-btn]').should('be.visible');
  });

  it('logs in as admin and out again', () => {
    cy.loginViaUi('admin');
    cy.get('[data-testid=whoami]').should('contain', 'admin');
    cy.get('[data-testid=tab-users]').should('be.visible');
    cy.get('[data-testid=logout-btn]').click();
    cy.get('[data-testid=login-btn]').should('be.visible');
  });

  it('keeps the session after a reload, and the session cookie is HttpOnly', () => {
    cy.loginViaUi('dispatcher');
    cy.reload();
    cy.get('[data-testid=whoami]').should('contain', 'dispatcher');
    cy.getCookie('sid').should('exist').and('have.property', 'httpOnly', true);
  });

  it('API refuses protected data without a session', () => {
    cy.request({ url: '/api/cars', failOnStatusCode: false }).its('status').should('eq', 401);
  });
});
