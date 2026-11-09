import crypto from 'node:crypto';

/**
 * Mots de passe : scrypt (fonction de dérivation résistante au matériel dédié), sel aléatoire de 16 octets.
 * Format stocké : scrypt$N$r$p$sel$empreinte (base64).
 */
const N = 1 << 15, R = 8, P = 1, KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 128 * N * R * 2 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: 128 * Number(n) * Number(r) * 2 });
  return crypto.timingSafeEqual(expected, actual);
}

/** Règles minimales : 10 caractères, au moins une lettre et un chiffre. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < 10) return 'Le mot de passe doit contenir au moins 10 caractères.';
  if (password.length > 200) return 'Mot de passe trop long.';
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return 'Le mot de passe doit contenir au moins une lettre et un chiffre.';
  return null;
}

export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Code d'invitation lisible : XXXX-XXXX-XXXX (sans caractères ambigus). */
export function invitationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i++) out += alphabet[bytes[i] % alphabet.length] + (i % 4 === 3 && i < 11 ? '-' : '');
  return out;
}

/** Limiteur de tentatives en mémoire (connexion, invitation). */
export class RateLimiter {
  private hits = new Map<string, { count: number; reset: number }>();
  constructor(private max: number, private windowMs: number) {}
  check(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) { this.hits.set(key, { count: 1, reset: now + this.windowMs }); return true; }
    h.count++;
    return h.count <= this.max;
  }
  clear(key: string) { this.hits.delete(key); }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
