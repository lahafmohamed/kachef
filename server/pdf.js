/**
 * تصدير PDF: Chromium بلا واجهة (puppeteer) يفتح صفحة /print/… من التطبيق نفسه
 * برمز جلسة المستخدم، و يطبعها إلى ملف PDF يُعاد للمتصفح كتحميل.
 *
 * The sheet is the same React page a user can preview, so there is one layout
 * to maintain; Chromium does the Arabic shaping, RTL and page breaks. One
 * browser stays warm between requests — launching Chrome is the slow part.
 */

let puppeteer = null;
try {
  puppeteer = require('puppeteer');
} catch {
  puppeteer = null;
}

let browserPromise = null;

function getBrowser() {
  if (!puppeteer) {
    const err = new Error('puppeteer is not installed');
    err.code = 'pdf_unavailable';
    return Promise.reject(err);
  }
  if (!browserPromise) {
    browserPromise = puppeteer
      .launch({
        headless: true,
        // PUPPETEER_EXECUTABLE_PATH lets the VPS use its packaged chromium
        // instead of the copy puppeteer downloads at install time.
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--font-render-hinting=none',
        ],
      })
      .then((browser) => {
        browser.on('disconnected', () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

/** True when the failure is "no Chrome here", as opposed to a bad page. */
function chromiumMissing(err) {
  return (
    err?.code === 'pdf_unavailable' ||
    /could not find chrome|failed to launch|ENOENT|spawn|executable/i.test(err?.message || '')
  );
}

/**
 * Renders one app page to PDF as the given user.
 * Resolves to { pdf: Buffer, title } — title is the tab title the page set,
 * which names the downloaded file.
 */
async function renderPdf({ url, token, lang = 'fr', section = null, timeoutMs = 45000 }) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // The app reads its session token and the قسم on screen from sessionStorage and
    // its language from localStorage; all must exist before the first script runs.
    await page.evaluateOnNewDocument(
      (tok, lng, sec) => {
        sessionStorage.setItem('auth.token', tok);
        if (sec) sessionStorage.setItem('view.section', sec);
        localStorage.setItem('lang', lng);
        localStorage.setItem('theme', 'light');
      },
      token,
      lang,
      section
    );
    await page.emulateMediaType('print');
    await page.goto(url, { waitUntil: 'networkidle0', timeout: timeoutMs });
    // The sheet only mounts once every fetch is in; an error state marks itself
    const el = await page.waitForSelector('.print-sheet, [data-print-error]', { timeout: timeoutMs });
    const failed = await el.evaluate((n) => n.hasAttribute('data-print-error'));
    if (failed) {
      const err = new Error('the print page reported an error');
      err.code = 'pdf_page_error';
      throw err;
    }
    // Fonts and photos still loading would print as boxes and blanks
    await page.evaluate(
      () =>
        Promise.all([
          document.fonts.ready,
          ...Array.from(document.images)
            .filter((img) => !img.complete)
            .map(
              (img) =>
                new Promise((resolve) => {
                  img.onload = resolve;
                  img.onerror = resolve;
                })
            ),
        ]),
      { timeout: timeoutMs }
    );
    const title = await page.title();
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
      timeout: timeoutMs,
    });
    return { pdf: Buffer.from(pdf), title };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { renderPdf, chromiumMissing };
