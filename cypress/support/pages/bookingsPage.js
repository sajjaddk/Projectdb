// Page object for the Bookings tab
class BookingsPage {
  visit() {
    cy.visit('/');
    cy.get('[data-testid=tab-bookings]').click();
    return this;
  }

  create({ customer_name, customer_phone, pickup, dropoff, distance_km, when = '2030-05-20T09:30' }) {
    cy.get('[data-testid=b-customer]').type(customer_name);
    cy.get('[data-testid=b-phone]').type(customer_phone);
    cy.get('[data-testid=b-pickup]').type(pickup);
    cy.get('[data-testid=b-dropoff]').type(dropoff);
    cy.get('[data-testid=b-distance]').type(String(distance_km));
    cy.get('[data-testid=b-when]').type(when);
    cy.get('[data-testid=b-submit]').click();
    return this;
  }

  row(text) {
    return cy.contains('[data-testid=booking-row]', text);
  }
}

export default new BookingsPage();
