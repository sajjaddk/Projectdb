import bookings from '../support/pages/bookingsPage';

describe('Dispatcher: bookings', () => {
  beforeEach(() => {
    cy.loginAs('dispatcher');
  });

  it('creates a booking and shows the server-calculated fare', () => {
    cy.uid().then((id) => {
      const customer_name = `CY Rider ${id}`;
      bookings.visit().create({
        customer_name, customer_phone: '555-0123', pickup: '1 Main Street', dropoff: '5 Park Avenue', distance_km: 12,
      });
      bookings.row(customer_name).should('contain', 'requested').and('contain', '$21.00');
    });
  });

  it('runs a full trip: assign -> start -> complete', () => {
    cy.seedCarWithDriver().then(({ car, driver }) => {
      cy.uid().then((id) => {
        const customer_name = `CY Trip ${id}`;
        bookings.visit().create({
          customer_name, customer_phone: '555-0124', pickup: 'Airport', dropoff: 'City Centre', distance_km: 20,
        });
        bookings.row(customer_name).find('[data-testid=assign-select]').select(`${car.plate} - ${driver.full_name}`);
        bookings.row(customer_name).find('[data-testid=assign-btn]').click();
        bookings.row(customer_name).find('[data-testid=booking-status]').should('have.text', 'assigned');
        bookings.row(customer_name).should('contain', car.plate);

        bookings.row(customer_name).find('[data-testid=start-btn]').click();
        bookings.row(customer_name).find('[data-testid=booking-status]').should('have.text', 'in_progress');
        bookings.row(customer_name).find('[data-testid=complete-btn]').click();
        bookings.row(customer_name).find('[data-testid=booking-status]').should('have.text', 'completed');
        bookings.row(customer_name).find('[data-testid=complete-btn]').should('not.exist');
      });
    });
  });

  it('cancels a requested booking', () => {
    cy.uid().then((id) => {
      const customer_name = `CY Cancel ${id}`;
      bookings.visit().create({
        customer_name, customer_phone: '555-0125', pickup: 'Hotel', dropoff: 'Station', distance_km: 3,
      });
      bookings.row(customer_name).find('[data-testid=cancel-btn]').click();
      bookings.row(customer_name).find('[data-testid=booking-status]').should('have.text', 'cancelled');
    });
  });

  it('refuses to assign without choosing a car', () => {
    cy.uid().then((id) => {
      const customer_name = `CY NoCar ${id}`;
      bookings.visit().create({
        customer_name, customer_phone: '555-0126', pickup: 'A Street', dropoff: 'B Street', distance_km: 2,
      });
      bookings.row(customer_name).find('[data-testid=assign-btn]').click();
      cy.get('[data-testid=message]').should('have.text', 'Select a car first');
    });
  });
});

describe('Dispatcher: role restrictions (RBAC)', () => {
  beforeEach(() => {
    cy.loginAs('dispatcher');
  });

  it('does not see the Users tab or admin-only forms', () => {
    cy.visit('/');
    cy.get('[data-testid=tab-users]').should('not.be.visible');
    cy.get('[data-testid=tab-drivers]').click();
    cy.get('[data-testid=d-submit]').should('not.be.visible');
    cy.get('[data-testid=tab-cars]').click();
    cy.get('[data-testid=c-submit]').should('not.be.visible');
  });

  it('is blocked by the API from admin actions', () => {
    cy.apiAs('dispatcher', 'GET', '/api/users').its('status').should('eq', 403);
    cy.newDriver().then((d) => cy.apiAs('dispatcher', 'POST', '/api/drivers', d).its('status').should('eq', 403));
  });

  it('does not render user data as HTML (XSS)', () => {
    cy.uid().then((id) => {
      const evil = `<img src=x onerror="window.__xss=1"> ${id}`;
      cy.apiAs('dispatcher', 'POST', '/api/bookings', {
        customer_name: evil, customer_phone: '555-0127', pickup: 'Somewhere', dropoff: 'Elsewhere',
        distance_km: 1, scheduled_at: new Date().toISOString(),
      }).its('status').should('eq', 201);
      bookings.visit();
      bookings.row(id).should('contain', '<img src=x');
      cy.window().its('__xss').should('be.undefined');
    });
  });
});
