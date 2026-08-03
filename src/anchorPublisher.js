import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { paths } from './config.js';

// -----------------------------------------------------------------------------
// Direkter Push in "Spotify for Podcasters" (Anchor) per Browser-Automation.
//
// WICHTIG: Es gibt keine offizielle API. Dieses Modul steuert die echte Weboberfläche
// (einloggen -> neue Folge -> Datei hochladen -> Titel/Text -> veröffentlichen).
// Das ist naturgemäß FRAGIL: Ändert Spotify das Layout, müssen die Selektoren unten
// angepasst werden. Bei Fehlern werden Screenshot + HTML in DATA_DIR/debug abgelegt,
// damit man genau sieht, wo es hakt.
// -----------------------------------------------------------------------------

const DASHBOARD = 'https://podcasters.spotify.com/pod/dashboard/episode/wizard';
const LOGIN_HINT = 'accounts.spotify.com';
const STATE_FILE = path.join(paths.data, 'anchor-state.json'); // gespeicherte Login-Session

// Mehrere mögliche Selektoren je Schritt (Fallbacks), da sich das UI ändern kann.
const SEL = {
  loginUser: ['#login-username', 'input[name="username"]', 'input[type="email"]'],
  loginPass: ['#login-password', 'input[name="password"]', 'input[type="password"]'],
  loginBtn: ['#login-button', 'button[type="submit"]'],
  fileInput: ['input[type="file"]'],
  title: ['input[placeholder*="title" i]', 'input[name="title"]', 'input[aria-label*="title" i]'],
  description: ['div[role="textbox"]', '.public-DraftEditor-content', 'div[contenteditable="true"]'],
  next: ['button:has-text("Next")', 'button:has-text("Weiter")'],
  publish: ['button:has-text("Publish now")', 'button:has-text("Publish")', 'button:has-text("Veröffentlichen")'],
  confirm: ['button:has-text("Publish")', 'button:has-text("Veröffentlichen")', 'button:has-text("Yes")'],
};

async function firstVisible(scope, selectors, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const loc = scope.locator(sel).first();
      if (await loc.count() && await loc.isVisible().catch(() => false)) return loc;
    }
    await scope.waitForTimeout(400);
  }
  throw new Error(`Kein sichtbares Element für: ${selectors.join(' | ')}`);
}

async function dumpDebug(page, name) {
  try {
    const dir = path.join(paths.data, 'debug');
    fs.mkdirSync(dir, { recursive: true });
    const shot = path.join(dir, `${name}-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true });
    return shot;
  } catch { return ''; }
}

async function doLogin(page, email, password) {
  // Falls wir auf der Login-Seite landen: Zugangsdaten eingeben.
  if (!page.url().includes(LOGIN_HINT) && !(await page.locator(SEL.loginUser[0]).count())) return;
  const user = await firstVisible(page, SEL.loginUser);
  await user.fill(email);
  const pass = await firstVisible(page, SEL.loginPass);
  await pass.fill(password);
  const btn = await firstVisible(page, SEL.loginBtn);
  await btn.click();
  await page.waitForLoadState('networkidle', { timeout: 45000 }).catch(() => {});
}

/**
 * Veröffentlicht eine fertige MP3 als neue Folge in Spotify for Podcasters.
 * @returns {Promise<{ok:boolean, error?:string, screenshot?:string}>}
 */
export async function publishToAnchor({ email, password, audioPath, title, description }) {
  if (!email || !password) return { ok: false, error: 'Anchor-Zugangsdaten fehlen (ANCHOR_EMAIL/ANCHOR_PASSWORD).' };
  if (!fs.existsSync(audioPath)) return { ok: false, error: `Audiodatei nicht gefunden: ${audioPath}` };

  const launchOpts = { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] };
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) launchOpts.executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH;

  const browser = await chromium.launch(launchOpts);
  const context = await browser.newContext(
    fs.existsSync(STATE_FILE) ? { storageState: STATE_FILE } : {}
  );
  const page = await context.newPage();
  page.setDefaultTimeout(30000);

  try {
    await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await doLogin(page, email, password);

    // Nach Login ggf. erneut zum Wizard navigieren.
    if (!page.url().includes('/episode/wizard')) {
      await page.goto(DASHBOARD, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    }

    // 1) Audiodatei hochladen (Datei-Input ist oft unsichtbar -> setInputFiles direkt).
    const fileInput = page.locator(SEL.fileInput[0]).first();
    await fileInput.waitFor({ state: 'attached', timeout: 30000 });
    await fileInput.setInputFiles(audioPath);

    // 2) Auf Upload-Verarbeitung warten und weiter.
    await page.waitForTimeout(2000);
    await clickIfPresent(page, SEL.next);

    // 3) Titel + Beschreibung setzen.
    const titleField = await firstVisible(page, SEL.title, 45000);
    await titleField.fill(title);
    const descField = await firstVisible(page, SEL.description);
    await descField.click();
    await descField.fill(description || '');

    // 4) Weiter bis zu den Veröffentlichungsoptionen.
    await clickIfPresent(page, SEL.next);

    // 5) Veröffentlichen (Standard: "jetzt") + Bestätigung.
    const pub = await firstVisible(page, SEL.publish, 30000);
    await pub.click();
    await clickIfPresent(page, SEL.confirm, 8000);

    await page.waitForTimeout(4000);

    // Login-Session für nächstes Mal speichern (weniger Anmeldungen = weniger Risiko).
    await context.storageState({ path: STATE_FILE }).catch(() => {});

    await browser.close();
    return { ok: true };
  } catch (err) {
    const screenshot = await dumpDebug(page, 'anchor-error');
    await browser.close().catch(() => {});
    return { ok: false, error: err.message, screenshot };
  }
}

async function clickIfPresent(page, selectors, timeout = 12000) {
  try {
    const loc = await firstVisible(page, selectors, timeout);
    await loc.click();
    await page.waitForTimeout(1200);
    return true;
  } catch {
    return false;
  }
}
