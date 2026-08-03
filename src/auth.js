import crypto from 'node:crypto';
import { config } from './config.js';

// Einfacher Ein-Nutzer-Login: ein Passwort, ein signiertes Cookie.
// Kein User-Management, keine Datenbank – bewusst minimal.

const COOKIE = 'pc_session';

function sign(value) {
  const mac = crypto.createHmac('sha256', config.sessionSecret).update(value).digest('hex');
  return `${value}.${mac}`;
}

function verify(signed) {
  if (!signed || !signed.includes('.')) return false;
  const idx = signed.lastIndexOf('.');
  const value = signed.slice(0, idx);
  const expected = sign(value);
  // zeit-konstanter Vergleich
  const a = Buffer.from(signed);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function issueCookie(res) {
  // Gültigkeitsstempel, damit das Cookie nach 30 Tagen abläuft.
  const value = `ok:${Date.now()}`;
  res.cookie(COOKIE, sign(value), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.publicUrl.startsWith('https'),
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearCookie(res) {
  res.clearCookie(COOKIE);
}

export function isLoggedIn(req) {
  const signed = req.cookies?.[COOKIE];
  if (!verify(signed)) return false;
  const ts = Number(signed.split(':')[1]?.split('.')[0]);
  if (!ts) return false;
  return Date.now() - ts < 30 * 24 * 60 * 60 * 1000;
}

export function checkPassword(input) {
  if (!config.password) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(config.password);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Schützt API-Routen (gibt JSON-Fehler zurück).
export function requireAuth(req, res, next) {
  if (isLoggedIn(req)) return next();
  res.status(401).json({ error: 'Nicht angemeldet' });
}
