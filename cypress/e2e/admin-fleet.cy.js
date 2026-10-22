describe('Admin: drivers and cars', () => {
  beforeEach(() => {
    cy.loginAs('admin');
  });

  it('creates a driver from the UI', () => {
    cy.newDriver().then((d) => {
      cy.visit('/');
      cy.get('[data-testid=tab-drivers]').click();
      cy.get('[data-testid=d-name]').type(d.full_name);
      cy.get('[data-testid=d-phone]').type(d.phone);
      cy.get('[data-testid=d-license]').type(d.license_number);
      cy.get('[data-testid=d-submit]').click();
      cy.contains('[data-testid=driver-row]', d.full_name).should('contain', d.license_number).and('contain', 'active');
    });
  });

  it('registers a car and assigns the new driver', () => {
    cy.newDriver().then((d) => cy.apiAs('admin', 'POST', '/api/drivers', d).then(() => {
      cy.newCar().then((car) => {
        cy.visit('/');
        cy.get('[data-testid=tab-cars]').click();
        cy.get('[data-testid=c-plate]').type(car.plate);
        cy.get('[data-testid=c-make]').type(car.make);
        cy.get('[data-testid=c-model]').type(car.model);
        cy.get('[data-testid=c-year]').type(String(car.year));
        cy.get('[data-testid=c-seats]').type(String(car.seats));
        cy.get('[data-testid=c-driver]').select(d.full_name);
        cy.get('[data-testid=c-submit]').click();
        cy.contains('[data-testid=car-row]', car.plate).should('contain', d.full_name);
      });
    }));
  });

  it('shows validation errors from the server (bad year)', () => {
    cy.visit('/');
    cy.get('[data-testid=tab-cars]').click();
    cy.get('[data-testid=c-plate]').type('BAD-1');
    cy.get('[data-testid=c-make]').type('Ford');
    cy.get('[data-testid=c-model]').type('Focus');
    cy.get('[data-testid=c-year]').type('2100');
    cy.get('[data-testid=c-seats]').type('4');
    cy.get('[data-testid=c-submit]').click();
    cy.get('[data-testid=message]').should('contain', 'Validation failed').and('contain', 'year');
  });

  it('toggles a car to maintenance and deletes it', () => {
    cy.newCar().then((car) => cy.apiAs('admin', 'POST', '/api/cars', car).then(() => {
      cy.visit('/');
      cy.get('[data-testid=tab-cars]').click();
      cy.contains('[data-testid=car-row]', car.plate).find('[data-testid=toggle-car]').click();
      cy.contains('[data-testid=car-row]', car.plate).should('contain', 'maintenance');
      cy.contains('[data-testid=car-row]', car.plate).find('[data-testid=delete-car]').click();
      cy.contains('[data-testid=car-row]', car.plate).should('not.exist');
    }));
  });
});

describe('Admin: user management', () => {
  it('adds a dispatcher account', () => {
    cy.loginAs('admin');
    cy.uid().then((id) => {
      const username = `cy-${id.toLowerCase()}`;
      cy.visit('/');
      cy.get('[data-testid=tab-users]').click();
      cy.get('[data-testid=u-name]').type(username);
      cy.get('[data-testid=u-password]').type('Cypress-Pass-12345', { log: false });
      cy.get('[data-testid=u-submit]').click();
      cy.contains('[data-testid=user-row]', username).should('contain', 'dispatcher');
    });
  });
});
