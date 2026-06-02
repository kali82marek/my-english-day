import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from './password';

describe('hashPassword / verifyPassword', () => {
  it('hash różni się od plaintextu', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
  });

  it('verifyPassword zwraca true dla poprawnego hasła', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(await verifyPassword('s3cret-pass', hash)).toBe(true);
  });

  it('verifyPassword zwraca false dla błędnego hasła', async () => {
    const hash = await hashPassword('s3cret-pass');
    expect(await verifyPassword('wrong-pass', hash)).toBe(false);
  });

  it('ten sam plaintext daje różne hashe (różne sole)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    // ...ale oba weryfikują się poprawnie
    expect(await verifyPassword('same-password', a)).toBe(true);
    expect(await verifyPassword('same-password', b)).toBe(true);
  });

  it('verifyPassword nie rzuca dla zniekształconego hasha', async () => {
    expect(await verifyPassword('x', 'nonsense')).toBe(false);
    expect(await verifyPassword('x', 'pbkdf2$abc$def')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});
