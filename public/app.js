'use strict';
// All dynamic text is inserted with textContent (never innerHTML) so user data cannot inject markup.
(() => {
  const $ = (sel) => document.querySelector(sel);
  let csrfToken = null;
  let me = null;
  let cars = [];
  let drivers = [];

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'text') node.textContent = v;
      else if (k === 'onclick') node.addEventListener('click', v);
      else node.setAttribute(k, v);
    }
    for (const c of children) node.append(c);
    return node;
  }

  let messageTimer;
  function showMessage(text, ok = false) {
    const box = $('#message');
    box.textContent = text;
    box.className = ok ? 'ok' : '';
    box.hidden = false;
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => { box.hidden = true; }, 4000);
  }

  async function api(method, url, body) {
    const headers = {};
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
    const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    if (res.status === 401 && me) { showLogin(); throw new Error('Session expired, please sign in again'); }
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const details = data.details ? ': ' + Object.entries(data.details).map(([f, m]) => `${f} ${m}`).join(', ') : '';
      throw new Error((data.error || 'Request failed') + details);
    }
    return data;
  }

  const run = (fn) => async (...args) => {
    try { await fn(...args); } catch (err) { showMessage(err.message); }
  };

  // ---------- views ----------
  function showLogin() {
    me = null; csrfToken = null;
    $('#app-view').hidden = true;
    $('#login-view').hidden = false;
  }

  function showApp(user) {
    me = user;
    $('#login-view').hidden = true;
    $('#app-view').hidden = false;
    $('#whoami').textContent = `${user.username} (${user.role})`;
    const isAdmin = user.role === 'admin';
    $('#tab-users-btn').hidden = !isAdmin;
    document.querySelectorAll('.admin-only').forEach((n) => { n.hidden = !isAdmin; });
    selectTab('bookings');
  }

  async function selectTab(name) {
    document.querySelectorAll('.tab').forEach((t) => { t.hidden = t.id !== `tab-${name}`; });
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    await run(async () => {
      if (name === 'bookings') { await loadCars(); await loadBookings(); }
      if (name === 'cars') { await loadDrivers(); await loadCars(); renderCarDriverSelect(); }
      if (name === 'drivers') await loadDrivers();
      if (name === 'users') await loadUsers();
    })();
  }

  // ---------- loaders / renderers ----------
  const cell = (text) => el('td', { text: String(text ?? '') });
  const badge = (status) => el('span', { class: `badge ${status}`, text: status });

  async function loadDrivers() {
    drivers = await api('GET', '/api/drivers');
    const body = $('#drivers-body');
    body.replaceChildren(...drivers.map((d) => {
      const actions = el('div', { class: 'actions' });
      if (me.role === 'admin') {
        actions.append(el('button', {
          class: 'secondary', 'data-testid': 'toggle-driver', text: d.status === 'active' ? 'Deactivate' : 'Activate',
          onclick: run(async () => { await api('PUT', `/api/drivers/${d.id}`, { status: d.status === 'active' ? 'inactive' : 'active' }); await loadDrivers(); }),
        }));
        actions.append(el('button', {
          class: 'danger', 'data-testid': 'delete-driver', text: 'Delete',
          onclick: run(async () => { await api('DELETE', `/api/drivers/${d.id}`); await loadDrivers(); }),
        }));
      }
      const tr = el('tr', { 'data-testid': 'driver-row' }, cell(d.id), cell(d.full_name), cell(d.phone), cell(d.license_number));
      tr.append(el('td', {}, badge(d.status)), el('td', {}, actions));
      return tr;
    }));
  }

  async function loadCars() {
    cars = await api('GET', '/api/cars');
    const body = $('#cars-body');
    body.replaceChildren(...cars.map((c) => {
      const actions = el('div', { class: 'actions' });
      if (me.role === 'admin') {
        actions.append(el('button', {
          class: 'secondary', 'data-testid': 'toggle-car', text: c.status === 'available' ? 'Set maintenance' : 'Set available',
          onclick: run(async () => { await api('PUT', `/api/cars/${c.id}`, { status: c.status === 'available' ? 'maintenance' : 'available' }); await loadCars(); }),
        }));
        actions.append(el('button', {
          class: 'danger', 'data-testid': 'delete-car', text: 'Delete',
          onclick: run(async () => { await api('DELETE', `/api/cars/${c.id}`); await loadCars(); }),
        }));
      }
      const tr = el('tr', { 'data-testid': 'car-row' }, cell(c.id), cell(c.plate), cell(`${c.make} ${c.model} (${c.year})`), cell(c.seats));
      tr.append(el('td', {}, badge(c.status)), cell(c.driver_name || '-'), el('td', {}, actions));
      return tr;
    }));
  }

  function renderCarDriverSelect() {
    const assigned = new Set(cars.map((c) => c.driver_id).filter(Boolean));
    const select = $('#car-driver-select');
    select.replaceChildren(
      el('option', { value: '', text: 'No driver' }),
      ...drivers.filter((d) => d.status === 'active' && !assigned.has(d.id))
        .map((d) => el('option', { value: String(d.id), text: d.full_name })),
    );
  }

  async function loadBookings() {
    const bookings = await api('GET', '/api/bookings');
    const free = cars.filter((c) => c.status === 'available' && c.driver_id);
    $('#bookings-body').replaceChildren(...bookings.map((b) => {
      const actions = el('div', { class: 'actions' });
      if (b.status === 'requested') {
        const select = el('select', { 'data-testid': 'assign-select' },
          el('option', { value: '', text: 'Select car' }),
          ...free.map((c) => el('option', { value: String(c.id), text: `${c.plate} - ${c.driver_name}` })));
        actions.append(select, el('button', {
          'data-testid': 'assign-btn', text: 'Assign',
          onclick: run(async () => {
            if (!select.value) throw new Error('Select a car first');
            await api('POST', `/api/bookings/${b.id}/assign`, { car_id: Number(select.value) });
            await loadCars(); await loadBookings();
          }),
        }));
      }
      const step = (action, label, cls = '') => el('button', {
        class: cls, 'data-testid': `${action}-btn`, text: label,
        onclick: run(async () => { await api('POST', `/api/bookings/${b.id}/${action}`); await loadCars(); await loadBookings(); }),
      });
      if (b.status === 'assigned') actions.append(step('start', 'Start'));
      if (b.status === 'in_progress') actions.append(step('complete', 'Complete'));
      if (b.status === 'requested' || b.status === 'assigned') actions.append(step('cancel', 'Cancel', 'danger'));

      const tr = el('tr', { 'data-testid': 'booking-row' }, cell(b.id), cell(`${b.customer_name} (${b.customer_phone})`),
        cell(`${b.pickup} -> ${b.dropoff}`), cell(b.distance_km), cell(`$${b.fare.toFixed(2)}`));
      tr.append(el('td', { 'data-testid': 'booking-status' }, badge(b.status)),
        cell(b.car_plate ? `${b.car_plate} / ${b.driver_name || '-'}` : '-'), el('td', {}, actions));
      return tr;
    }));
  }

  async function loadUsers() {
    const users = await api('GET', '/api/users');
    $('#users-body').replaceChildren(...users.map((u) =>
      el('tr', { 'data-testid': 'user-row' }, cell(u.id), cell(u.username), cell(u.role))));
  }

  // ---------- forms ----------
  function formData(form, numeric = []) {
    const data = Object.fromEntries(new FormData(form));
    for (const k of numeric) data[k] = data[k] === '' || data[k] === undefined ? null : Number(data[k]);
    return data;
  }

  $('#login-form').addEventListener('submit', run(async (e) => {
    e.preventDefault();
    const { username, password } = formData(e.target);
    const res = await api('POST', '/api/auth/login', { username, password });
    csrfToken = res.csrfToken;
    e.target.reset();
    showApp(res.user);
  }));

  $('#logout-btn').addEventListener('click', run(async () => {
    await api('POST', '/api/auth/logout');
    showLogin();
  }));

  $('#tabs').addEventListener('click', (e) => { if (e.target.dataset.tab) selectTab(e.target.dataset.tab); });

  $('#driver-form').addEventListener('submit', run(async (e) => {
    e.preventDefault();
    await api('POST', '/api/drivers', formData(e.target));
    e.target.reset(); showMessage('Driver created', true); await loadDrivers();
  }));

  $('#car-form').addEventListener('submit', run(async (e) => {
    e.preventDefault();
    await api('POST', '/api/cars', formData(e.target, ['year', 'seats', 'driver_id']));
    e.target.reset(); showMessage('Car registered', true);
    await loadDrivers(); await loadCars(); renderCarDriverSelect();
  }));

  $('#booking-form').addEventListener('submit', run(async (e) => {
    e.preventDefault();
    const data = formData(e.target, ['distance_km']);
    data.scheduled_at = new Date(data.scheduled_at).toISOString();
    await api('POST', '/api/bookings', data);
    e.target.reset(); showMessage('Booking created', true); await loadCars(); await loadBookings();
  }));

  $('#user-form').addEventListener('submit', run(async (e) => {
    e.preventDefault();
    await api('POST', '/api/users', formData(e.target));
    e.target.reset(); showMessage('User added', true); await loadUsers();
  }));

  // ---------- boot ----------
  (async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) { const data = await res.json(); csrfToken = data.csrfToken; showApp(data.user); return; }
    } catch { /* fall through to login */ }
    showLogin();
  })();
})();
