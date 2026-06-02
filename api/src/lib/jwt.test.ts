import { describe, it, expect } from 'vitest';
import { signSession, verifySession } from './jwt';

const SECRET = 'test-secret-please-change';

describe('signSession / verifySession', () => {
  it('round-trip zwraca sub jako string', async () => {
    const token = await signSession(42, SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('42');
  });

  it('akceptuje userId jako string', async () => {
    const token = await signSession('user-abc', SECRET);
    const payload = await verifySession(token, SECRET);
    expect(payload?.sub).toBe('user-abc');
  });

  it('zły sekret → null', async () => {
    const token = await signSession(1, SECRET);
    expect(await verifySession(token, 'inny-sekret')).toBeNull();
  });

  it('zmanipulowany token → null', async () => {
    const token = await signSession(1, SECRET);
    const tampered = token.slice(0, -2) + (token.endsWith('aa') ? 'bb' : 'aa');
    expect(await verifySession(tampered, SECRET)).toBeNull();
  });

  it('śmieciowy token → null', async () => {
    expect(await verifySession('not-a-jwt', SECRET)).toBeNull();
    expect(await verifySession('', SECRET)).toBeNull();
  });
});
