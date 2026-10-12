import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from '../../api/unlock-card';

const req = (body: unknown) => new Request('http://x/api/unlock-card', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });

describe('unlock-card function', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.CARD_JSON = '{"title":"Secret card"}';
    process.env.CARD_PASSCODE = '4321';
  });
  afterEach(() => {
    vi.useRealTimers();
    delete process.env.CARD_JSON;
    delete process.env.CARD_PASSCODE;
  });

  it('returns the card for the right passcode, uncached', async () => {
    const res = await POST(req({ passcode: ' 4321 ' }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ title: 'Secret card' });
  });

  it('rejects wrong, missing or malformed passcodes after a delay, without leaking the card', async () => {
    for (const body of [{ passcode: '1234' }, {}, 'not json']) {
      const pending = POST(req(body));
      await vi.advanceTimersByTimeAsync(1000);
      const res = await pending;
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain('Secret');
    }
  });

  it('reports 503 when the site has no card configured', async () => {
    delete process.env.CARD_JSON;
    expect((await POST(req({ passcode: '4321' }))).status).toBe(503);
  });
});
