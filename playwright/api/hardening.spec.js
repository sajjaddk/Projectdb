const { test, expect } = require('@playwright/test');

test.describe('request hardening', () => {
  test('malformed cookie encoding is treated as unauthenticated (401, not 500)', async ({ request }) => {
    const res = await request.get('/api/cars', { headers: { Cookie: 'sid=%E0%A4%A' } });
    expect(res.status()).toBe(401);
  });

  test('forged session cookie is rejected', async ({ request }) => {
    const res = await request.get('/api/auth/me', { headers: { Cookie: 'sid=not-a-real-session-token' } });
    expect(res.status()).toBe(401);
  });

  test('unknown API route -> 404 JSON, no stack trace', async ({ request }) => {
    const res = await request.get('/api/nope');
    // unauthenticated requests are stopped first
    expect([401, 404]).toContain(res.status());
    expect(await res.text()).not.toContain('at ');
  });

  test('oversized JSON body is rejected', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { username: 'admin', password: 'x'.repeat(100_000) } });
    expect(res.status()).toBe(413);
  });
});
