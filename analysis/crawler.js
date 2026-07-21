/*
 * Competitive-analysis crawler (Playwright, headless Chromium)
 * Usage: node crawl.js <siteKey> <startUrl> <outDir> [maxPages]
 *
 * Rules implemented:
 *  - Public pages only; never submits forms or authenticates.
 *  - Respects robots.txt (User-agent: *) Disallow rules.
 *  - >= 2.2s delay between page loads.
 *  - Saves per page: full-page JPEG screenshot, rendered text, title/meta -> pages.json + summary.md
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const [, , siteKey, startUrl, outDir, maxArg] = process.argv;
const MAX_PAGES = parseInt(maxArg || '24', 10);
const DELAY = 2200;
const NAV_TIMEOUT = 45000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const start = new URL(startUrl);
const baseDomain = start.hostname.split('.').slice(-2).join('.');

function sameSite(u) {
  try {
    const h = new URL(u).hostname;
    return h === start.hostname || h === baseDomain || h.endsWith('.' + baseDomain);
  } catch {
    return false;
  }
}
function normalize(u) {
  const x = new URL(u);
  x.hash = '';
  ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'gclid'].forEach((p) =>
    x.searchParams.delete(p)
  );
  let s = x.toString();
  if (x.pathname !== '/' && s.endsWith('/')) s = s.slice(0, -1);
  return s;
}
function slugFor(u) {
  const x = new URL(u);
  let p = decodeURIComponent(x.pathname);
  const host = x.hostname === start.hostname ? '' : x.hostname.replace(/\./g, '_') + '__';
  if (p === '/' || p === '') p = 'home';
  else p = p.replace(/^\/+|\/+$/g, '').replace(/[\\/:*?"<>|\s]+/g, '_');
  const q = x.search ? '_q_' + x.search.slice(1).replace(/[\\/:*?"<>|\s&=]+/g, '_') : '';
  return (host + p + q).slice(0, 110);
}

function parseRobots(t) {
  const dis = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of t.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === 'user-agent') applies = v === '*';
    else if (k === 'disallow' && applies && v) dis.push(v);
    else if (k === 'sitemap') sitemaps.push(v);
  }
  return { disallow: dis, sitemaps };
}
function allowed(u, robots) {
  const p = new URL(u).pathname;
  return !robots.disallow.some((d) => p.startsWith(d.replace(/\*.*$/, '')));
}

(async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  let ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ar-SA' });

  // robots.txt
  let robots = { disallow: [], sitemaps: [] };
  try {
    const r = await ctx.request.get(start.origin + '/robots.txt', { timeout: 15000 });
    if (r.ok()) {
      const t = await r.text();
      if (!/<html/i.test(t)) {
        fs.writeFileSync(path.join(outDir, 'robots.txt'), t, 'utf8');
        robots = parseRobots(t);
      }
    }
  } catch (e) {}

  // raw no-JS shell of homepage (CSR/SSR evidence) + response headers
  try {
    const r = await ctx.request.get(startUrl, { timeout: 20000 });
    fs.writeFileSync(path.join(outDir, 'home.raw.html'), await r.text(), 'utf8');
    fs.writeFileSync(path.join(outDir, 'home.headers.json'), JSON.stringify(r.headers(), null, 2), 'utf8');
  } catch (e) {}

  // sitemap(s), one level of nesting
  let sitemapUrls = [];
  const smSources = robots.sitemaps.length ? robots.sitemaps.slice(0, 3) : [start.origin + '/sitemap.xml'];
  const smSeen = new Set();
  while (smSources.length && smSeen.size < 6) {
    const sm = smSources.shift();
    if (smSeen.has(sm)) continue;
    smSeen.add(sm);
    try {
      const r = await ctx.request.get(sm, { timeout: 15000 });
      if (!r.ok()) continue;
      const xml = await r.text();
      if (!xml.includes('<loc>')) continue;
      if (smSeen.size === 1) fs.writeFileSync(path.join(outDir, 'sitemap.xml'), xml, 'utf8');
      for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
        const loc = m[1];
        if (/\.xml$/i.test(loc)) smSources.push(loc);
        else sitemapUrls.push(loc);
      }
    } catch (e) {}
  }
  sitemapUrls = sitemapUrls.slice(0, 25);

  const seeds = [
    '/pricing', '/plans', '/features', '/about', '/contact', '/blog', '/faq',
    '/privacy-policy', '/privacy', '/terms', '/register', '/signup', '/login', '/en', '/ar',
  ].map((p) => start.origin + p);

  const queue = [normalize(startUrl), ...sitemapUrls.filter(sameSite).map(normalize), ...seeds.map(normalize)];
  const enqueued = new Set(queue);
  const visitedFinal = new Set();
  const manifest = [];
  const agg = { thirdParty: {}, homepageScripts: [] };
  const isBlogUrl = (u) => /\/blog|\/news|\/article|\/مقالات/i.test(u);
  let n = 0;
  let retriedUA = false;

  while (queue.length && n < MAX_PAGES) {
    const url = queue.shift();
    if (!sameSite(url) || !allowed(url, robots)) continue;
    n++;
    const page = await ctx.newPage();
    const reqHosts = new Set();
    const scriptUrls = [];
    page.on('request', (rq) => {
      try {
        if (!sameSite(rq.url())) reqHosts.add(new URL(rq.url()).hostname);
        if (rq.resourceType() === 'script') scriptUrls.push(rq.url());
      } catch {}
    });
    let entry = { n, url };
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
      await page.waitForLoadState('networkidle', { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(2500);
      entry.status = resp ? resp.status() : null;
      const finalUrl = normalize(page.url());
      entry.finalUrl = finalUrl;

      const info = await page.evaluate(() => {
        const meta = {};
        document.querySelectorAll('meta[name],meta[property]').forEach((m) => {
          const k = m.getAttribute('name') || m.getAttribute('property');
          if (k && !meta[k]) meta[k] = (m.getAttribute('content') || '').slice(0, 300);
        });
        const html = document.documentElement;
        return {
          title: document.title,
          lang: html.getAttribute('lang'),
          dir: html.getAttribute('dir'),
          meta,
          canonical: (document.querySelector('link[rel="canonical"]') || {}).href || null,
          hreflang: [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => ({
            hreflang: l.getAttribute('hreflang'),
            href: l.href,
          })),
          h: [...document.querySelectorAll('h1,h2,h3')]
            .map((e) => e.tagName + ': ' + e.innerText.trim().replace(/\s+/g, ' '))
            .filter((x) => x.length > 4)
            .slice(0, 60),
          text: (document.body ? document.body.innerText : '').slice(0, 200000),
          links: [...document.querySelectorAll('a[href]')].map((a) => a.href),
          fw: {
            next: !!window.__NEXT_DATA__ || !!document.getElementById('__next'),
            nuxt: !!window.__NUXT__ || !!document.getElementById('__nuxt'),
            flutter: !!document.querySelector('flt-glass-pane,flutter-view') || !!window._flutter,
            angular: !!document.querySelector('[ng-version]'),
            gatsby: !!document.getElementById('___gatsby'),
            wp: /wp-content|wp-includes/.test(document.documentElement.outerHTML.slice(0, 400000)),
            vite: [...document.scripts].some((s) => /\/assets\/index-[^/]*\.js/.test(s.src)),
            reactHints:
              !!document.querySelector('[data-reactroot],[data-reactid]') ||
              [...document.scripts].some((s) => /react/i.test(s.src)),
          },
          generator: (document.querySelector('meta[name="generator"]') || {}).content || null,
        };
      });

      // bot-challenge detection on first page: retry ONCE with a standard UA, otherwise mark blocked
      const challenge = /just a moment|attention required|checking your browser|access denied|verify you are human/i.test(
        (info.title || '') + ' ' + info.text.slice(0, 400)
      );
      if (n === 1 && challenge && !retriedUA) {
        retriedUA = true;
        console.log(`[${siteKey}] challenge page detected, retrying once with standard UA`);
        await page.close();
        await ctx.close();
        ctx = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          locale: 'ar-SA',
          userAgent:
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        });
        queue.unshift(url);
        enqueued.add(url);
        n--;
        await sleep(DELAY);
        continue;
      }
      if (n === 1 && challenge) {
        fs.writeFileSync(path.join(outDir, 'BLOCKED.txt'), `Challenge page at ${url}\nTitle: ${info.title}`, 'utf8');
        console.log(`[${siteKey}] BLOCKED by challenge page; stopping this site.`);
        await page.close();
        break;
      }

      if (visitedFinal.has(finalUrl)) {
        entry.skipped = 'duplicate-after-redirect';
        manifest.push(entry);
        fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(manifest, null, 2), 'utf8');
        await page.close();
        console.log(`[${siteKey}] ${n}/${MAX_PAGES} DUP ${url} -> ${finalUrl}`);
        await sleep(DELAY);
        continue;
      }
      visitedFinal.add(finalUrl);
      if (n === 1) {
        entry.headers = resp ? resp.headers() : {};
        agg.homepageScripts = scriptUrls.slice(0, 60);
      }

      const slug = slugFor(finalUrl);
      entry = {
        ...entry,
        slug,
        title: info.title,
        lang: info.lang,
        dir: info.dir,
        meta: {
          description: info.meta['description'],
          ogTitle: info.meta['og:title'],
          ogDescription: info.meta['og:description'],
          ogImage: info.meta['og:image'],
          robots: info.meta['robots'],
        },
        canonical: info.canonical,
        hreflang: info.hreflang,
        h: info.h,
        fw: info.fw,
        generator: info.generator,
        textLength: info.text.length,
        thirdPartyHosts: [...reqHosts].sort(),
      };
      fs.writeFileSync(path.join(outDir, slug + '.txt'), `URL: ${finalUrl}\nTITLE: ${info.title}\n\n${info.text}`, 'utf8');
      try {
        await page.screenshot({ path: path.join(outDir, slug + '.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
      } catch (e) {
        try {
          await page.screenshot({ path: path.join(outDir, slug + '.viewport.jpg'), type: 'jpeg', quality: 80 });
        } catch (e2) {}
      }
      [...reqHosts].forEach((h) => (agg.thirdParty[h] = (agg.thirdParty[h] || 0) + 1));

      // enqueue discovered same-site links ahead of guessed seeds
      let added = 0;
      for (const l of info.links) {
        try {
          if (!sameSite(l)) continue;
          const nl = normalize(l);
          const pn = new URL(nl).pathname;
          if (/\.(pdf|jpg|jpeg|png|webp|svg|gif|zip|apk|mp4|xml|ico|css|js|woff2?)$/i.test(pn)) continue;
          if (isBlogUrl(nl)) {
            const blogCount =
              manifest.filter((m) => m.slug && isBlogUrl(m.finalUrl || '')).length +
              queue.filter((q) => isBlogUrl(q)).length;
            if (blogCount >= 4) continue;
          }
          if (!enqueued.has(nl)) {
            enqueued.add(nl);
            queue.splice(added, 0, nl);
            added++;
          }
        } catch {}
      }
    } catch (e) {
      entry.error = String(e).slice(0, 300);
    }
    manifest.push(entry);
    fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(manifest, null, 2), 'utf8');
    await page.close();
    console.log(`[${siteKey}] ${n}/${MAX_PAGES} ${entry.status || 'ERR'} ${url}${entry.error ? ' !! ' + entry.error : ''}`);
    await sleep(DELAY);
  }

  // Mobile pass (390px) for homepage + up to 2 pricing/feature pages
  try {
    const mob = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      deviceScaleFactor: 2,
      locale: 'ar-SA',
    });
    const keyPages = [
      normalize(startUrl),
      ...manifest
        .filter((m) => m.slug && /pric|plan|feature|أسعار|الأسعار|باقات|المزايا|مميزات/i.test((m.finalUrl || '') + ' ' + (m.title || '')))
        .map((m) => m.finalUrl),
    ]
      .filter((v, i, a) => v && a.indexOf(v) === i)
      .slice(0, 3);
    for (const u of keyPages) {
      try {
        const p = await mob.newPage();
        await p.goto(u, { waitUntil: 'domcontentloaded', timeout: NAV_TIMEOUT });
        await p.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});
        await p.waitForTimeout(2500);
        await p.screenshot({ path: path.join(outDir, slugFor(u) + '.mobile390.jpg'), fullPage: true, type: 'jpeg', quality: 80 });
        await p.close();
        console.log(`[${siteKey}] mobile 390px captured: ${u}`);
      } catch (e) {
        console.log(`[${siteKey}] mobile err ${u}: ${String(e).slice(0, 120)}`);
      }
      await sleep(DELAY);
    }
    await mob.close();
  } catch (e) {}

  // summary.md
  const s = [];
  s.push(`# Crawl summary — ${siteKey}`, `Start: ${startUrl}`, `Date: ${new Date().toISOString()}`,
    `Pages captured: ${manifest.filter((m) => m.slug).length} (of ${manifest.length} attempts)`,
    `robots.txt disallow (UA *): ${JSON.stringify(robots.disallow)}`,
    `sitemap page URLs found: ${sitemapUrls.length}`, '');
  s.push('## Third-party request hosts (page count)');
  Object.entries(agg.thirdParty).sort((a, b) => b[1] - a[1]).forEach(([h, c]) => s.push(`- ${h}: ${c}`));
  s.push('', '## Homepage script URLs (first 60)');
  agg.homepageScripts.forEach((u) => s.push('- ' + u));
  s.push('', '## Pages');
  for (const m of manifest) {
    if (!m.slug) {
      s.push(`- SKIP/ERR ${m.url} ${m.error || m.skipped || ''}`);
      continue;
    }
    s.push(
      `### ${m.slug}`,
      `- url: ${m.finalUrl}`,
      `- status: ${m.status} | lang=${m.lang} dir=${m.dir} | textLen=${m.textLength}`,
      `- title: ${m.title}`,
      `- desc: ${m.meta.description || '—'}`,
      `- fw: ${JSON.stringify(m.fw)} | generator: ${m.generator || '—'}`,
      `- canonical: ${m.canonical || '—'} | hreflang: ${m.hreflang.map((h) => h.hreflang).join(',') || '—'}`,
      `- headings: ${m.h.slice(0, 12).join(' | ')}`,
      ''
    );
  }
  fs.writeFileSync(path.join(outDir, 'summary.md'), s.join('\n'), 'utf8');
  await browser.close();
  console.log(`[${siteKey}] DONE`);
})();
