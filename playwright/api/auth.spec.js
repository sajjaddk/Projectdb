const { test, expect } = require('@playwright/test');
const { CREDS, apiAs } = require('../helpers');

test.describe('auth API', () => {
  test('health endpoint is public', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  test('valid login returns user, csrf token and an HttpOnly SameSite=Strict cookie', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: CREDS.admin });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(body.csrfToken).toBeTruthy();
    expect(body.user.password_hash).toBeUndefined();
    const cookie = res.headers()['set-cookie'];
    expect(cookie).toContain('sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  test('wrong password and unknown user get the same generic 401', async ({ request }) => {
    const wrongPw = await request.post('/api/auth/login', { data: { username: 'dispatcher', password: 'nope-nope-nope' } });
    const noUser = await request.post('/api/auth/login', { data: { username: 'ghost-user', password: 'nope-nope-nope' } });
    expect(wrongPw.status()).toBe(401);
    expect(noUser.status()).toBe(401);
    expect(await wrongPw.json()).toEqual(await noUser.json());
  });

  test('missing credentials -> 400', async ({ request }) => {
    expect((await request.post('/api/auth/login', { data: {} })).status()).toBe(400);
    expect((await request.post('/api/auth/login', { data: { username: 'admin', password: 123 } })).status()).toBe(400);
  });

  test('account locks after 5 failed attempts (429), even with the right password', async ({ request }) => {
    const username = 'ghost-lockout'; // separate key so other tests are not affected
    for (let i = 0; i < 5; i++) {
      expect((await request.post('/api/auth/login', { data: { username, password: 'bad-password-1' } })).status()).toBe(401);
    }
    expect((await request.post('/api/auth/login', { data: { username, password: 'bad-password-1' } })).status()).toBe(429);
  });

  test('protected endpoints need a session -> 401', async ({ request }) => {
    for (const url of ['/api/cars', '/api/drivers', '/api/bookings', '/api/users', '/api/auth/me']) {
      expect((await request.get(url)).status(), url).toBe(401);
    }
  });

  test('/me returns the logged-in user', async ({ baseURL }) => {
    const c = await apiAs('dispatcher', baseURL);
    const res = await c.get('/api/auth/me');
    expect(res.status()).toBe(200);
    expect((await res.json()).user.role).toBe('dispatcher');
    await c.dispose();
  });

  test('logout invalidates the session', async ({ baseURL }) => {
    const c = await apiAs('dispatcher', baseURL);
    expect((await c.post('/api/auth/logout')).status()).toBe(204);
    expect((await c.get('/api/auth/me')).status()).toBe(401);
    await c.dispose();
  });

  test('state-changing request without CSRF token -> 403', async ({ baseURL }) => {
    const c = await apiAs('admin', baseURL);
    const res = await c.ctx.post('/api/drivers', { data: { full_name: 'No Csrf', phone: '5550001111', license_number: 'NOCSRF1' } });
    expect(res.status()).toBe(403);
    await c.dispose();
  });

  test('security headers are present', async ({ request }) => {
    const res = await request.get('/');
    const h = res.headers();
    expect(h['content-security-policy']).toContain("script-src 'self'");
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-powered-by']).toBeUndefined();
  });
});
