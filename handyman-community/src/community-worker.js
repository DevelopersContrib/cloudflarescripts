/**
 * Handyman Community Lander — CF Worker (runtime-dynamic, no placeholders)
 * Vertical: Handyman | Worker: handyman-community
 *
 * All values resolved at request time from:
 *   env.HANDYMAN_API_URL, env.WORKER_API_KEY,
 *   VNOC workerinfo API, hostname detection
 */

const CACHE_TTL           = 15 * 60;            // 15 min — projects / questions
const CACHE_TTL_DOMAIN    = 60 * 60;            // 60 min — VNOC domain info
const CACHE_TTL_AFFILIATE = 60 * 60 * 24 * 30; // 30 days — affiliate ref_id
const BRAND_COLOR_DEFAULT = "#670708";
const ACCENT_COLOR        = "#FF9000";
const HANDYMAN_LOGO_URL   = "https://www.handyman.com/logo.png";
const VNOC_API_URL        = "https://manage.vnoc.com";
const VNOC_API_KEY        = "b102e32a4bf14b575f352186e265ed7c7272cde4ded39f0c478530f6b358c9c4";

// Default partner network — shown when VNOC API returns no partners
// Logo: use each domain's own logo path; fallback to Google favicon service
const DEFAULT_PARTNERS = [
  { domain: "handyman.com",    url: "https://www.handyman.com",    description: "Find trusted handymen & contractors",    logo_url: "https://www.handyman.com/logo.png" },
  { domain: "vnoc.com",        url: "https://www.vnoc.com",        description: "Domain portfolio management platform",   logo_url: "https://www.vnoc.com/images/logo.png" },
  { domain: "ventureos.com",   url: "https://www.ventureos.com",   description: "AI-powered venture operating system",    logo_url: "https://www.ventureos.com/logo.png" },
  { domain: "contrib.com",     url: "https://www.contrib.com",     description: "Startup equity & contribution platform", logo_url: "https://www.contrib.com/images/logo.png" },
  { domain: "referrals.com",   url: "https://www.referrals.com",   description: "Referral marketing made simple",         logo_url: "https://www.referrals.com/logo.png" },
  { domain: "agentdao.com",    url: "https://www.agentdao.com",    description: "Decentralized AI agent marketplace",     logo_url: "https://www.agentdao.com/logo.png" },
  { domain: "paydirect.com",   url: "https://www.paydirect.com",   description: "Direct payment solutions",               logo_url: "https://www.paydirect.com/logo.png" },
  { domain: "agentbank.com",   url: "https://www.agentbank.com",   description: "Banking for AI agents",                  logo_url: "https://www.agentbank.com/logo.png" },
  { domain: "veganist.com",    url: "https://www.veganist.com",    description: "Vegan lifestyle & community",            logo_url: "https://www.veganist.com/logo.png" },
];

export default {
  async fetch(request, env) {
    const url      = new URL(request.url);
    const hostname = url.hostname.replace(/^www\./, "");
    const HANDYMAN_API = (env.HANDYMAN_API_URL ?? "https://www.handyman.com").replace(/\/$/, "");
    const WORKER_KEY   = env.WORKER_API_KEY ?? "";

    // Static routes
    if (url.pathname === "/robots.txt") {
      return new Response(
        `User-agent: *\nAllow: /\nSitemap: https://${hostname}/sitemap.xml`,
        { headers: { "Content-Type": "text/plain" } }
      );
    }
    if (url.pathname === "/sitemap.xml") {
      const today = new Date().toISOString().split("T")[0];
      const pages = [
        { loc: "/",             changefreq: "daily",   priority: "1.0" },
        { loc: "/contractors",  changefreq: "daily",   priority: "0.9" },
        { loc: "/questions",    changefreq: "hourly",  priority: "0.8" },
        { loc: "/projects",     changefreq: "hourly",  priority: "0.8" },
        { loc: "/contribute",   changefreq: "daily",   priority: "0.7" },
        { loc: "/partners",     changefreq: "weekly",  priority: "0.6" },
        { loc: "/about",        changefreq: "monthly", priority: "0.5" },
        { loc: "/privacy",      changefreq: "monthly", priority: "0.3" },
        { loc: "/terms",        changefreq: "monthly", priority: "0.3" },
      ];
      const urls = pages.map(p =>
        `<url><loc>https://${hostname}${p.loc}</loc><lastmod>${today}</lastmod><changefreq>${p.changefreq}</changefreq><priority>${p.priority}</priority></url>`
      ).join("\n  ");
      const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
        xsi:schemaLocation="http://www.sitemaps.org/schemas/sitemap/0.9
          http://www.sitemaps.org/schemas/sitemap/0.9/sitemap.xsd">
  ${urls}
</urlset>`;
      return new Response(sitemap, {
        headers: {
          "Content-Type":  "application/xml; charset=UTF-8",
          "Cache-Control": "public, max-age=3600",
        }
      });
    }

    // Fetch domain info, affiliate ID, and content in parallel
    const [domainInfo, refId, projects, questions, contractors, contribTasks] = await Promise.all([
      fetchDomainInfo(hostname, env),
      getOrRegisterAffiliate(hostname, HANDYMAN_API, WORKER_KEY, env),
      fetchProjects(HANDYMAN_API, env),
      fetchQuestions(HANDYMAN_API, env),
      fetchContractors(HANDYMAN_API, env),
      fetchContribTasks(hostname, env),
    ]);

    // signupLink + referLink needed for several routes below
    const signupLinkEarly = refId
      ? `${HANDYMAN_API}/signup?ref=${refId}&refType=contractor`
      : `${HANDYMAN_API}/signup`;

    if (url.pathname === "/.well-known/agent.json") {
      return Response.json({
        "@context":   "https://schema.org",
        "@type":      "WebSite",
        "name":       domainInfo.site_name,
        "url":        `https://${hostname}`,
        "domain":     hostname,
        "vertical":   "Handyman",
        "hub":        HANDYMAN_API,
        "description": domainInfo.tagline,
        "network":    "Handyman Partner Network",
        "publisher": {
          "@type": "Organization",
          "name":  "VNOC / VentureOS",
          "url":   "https://www.vnoc.com",
        },
        "potentialAction": [
          { "@type": "SearchAction",  "target": `${HANDYMAN_API}/contractors?q={query}`, "query-input": "required name=query" },
          { "@type": "RegisterAction","target": `${HANDYMAN_API}/signup`,                "name": "Join as Contractor" },
        ],
        "sameAs": [ HANDYMAN_API, `https://www.handyman.com/partners` ],
        "inLanguage":         "en-US",
        "copyrightYear":      new Date().getFullYear(),
        "license":            `https://${hostname}/terms`,
        "privacyPolicy":      `https://${hostname}/privacy`,
        "sitemap":            `https://${hostname}/sitemap.xml`,
        "agentCapabilities":  ["content-indexing","lead-capture","affiliate-referral"],
        "partnerNetwork":     "https://www.vnoc.com",
        "contactPoint": {
          "@type":       "ContactPoint",
          "contactType": "Partner Inquiries",
          "url":         `${HANDYMAN_API}/partners`,
        },
      }, {
        headers: { "Cache-Control": "public, max-age=86400" }
      });
    }

    if (url.pathname === "/contribute") {
      return new Response(renderContributePage(hostname, domainInfo, contribTasks, HANDYMAN_API, signupLinkEarly), {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=300" }
      });
    }

    if (url.pathname === "/about") {
      return new Response(renderStaticPage("about", hostname, domainInfo, HANDYMAN_API), {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=3600" }
      });
    }
    if (url.pathname === "/privacy") {
      return new Response(renderStaticPage("privacy", hostname, domainInfo, HANDYMAN_API), {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=86400" }
      });
    }
    if (url.pathname === "/terms") {
      return new Response(renderStaticPage("terms", hostname, domainInfo, HANDYMAN_API), {
        headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=86400" }
      });
    }

    const signupLink = signupLinkEarly;
    const referLink  = `${HANDYMAN_API}/refer/${hostname.replace(/\./g, "-")}`;

    const html = renderPage({
      hostname,
      domainInfo,
      signupLink,
      referLink,
      projects,
      questions,
      contractors,
      HANDYMAN_API,
    });

    return new Response(html, {
      headers: {
        "Content-Type":  "text/html;charset=UTF-8",
        "Cache-Control": "public, max-age=180",
      },
    });
  },
};

// ─── VNOC domain info ────────────────────────────────────────────────────────

async function fetchDomainInfo(hostname, env) {
  const DEFAULT = {
    site_name:       "Handyman Community",
    tagline:         "Real Projects. Real Answers. Find trusted contractors near you.",
    logo_url:        "",
    logo_html:       "",
    partner_domains: DEFAULT_PARTNERS,  // [{ domain, url, description, logo_url }]
    related_domains: [],                // [{ domain, url }] or [string]
    brand_color:     BRAND_COLOR_DEFAULT,
  };

  try {
    const cacheKey = `vnoc:info:${hostname}`;
    if (env.CACHE) {
      const cached = await env.CACHE.get(cacheKey);
      if (cached) return { ...DEFAULT, ...JSON.parse(cached) };
    }

    const apiKey = env.VNOC_API_KEY ?? VNOC_API_KEY;
    const res = await fetch(
      `${VNOC_API_URL}/v2/domainsite/workerinfo?domain=${encodeURIComponent(hostname)}&key=${apiKey}`,
      { headers: { Accept: "application/json" }, cf: { cacheTtl: 0 } }
    );

    if (res.ok) {
      const raw  = await res.json();
      const data = raw.data ?? raw;

      // Normalize partner_domains — accept array of objects or strings
      const rawPartners = data.partner_domains ?? data.partners ?? [];
      const partnerDomains = rawPartners.map(p =>
        typeof p === "string"
          ? { domain: p, url: `https://${p}`, description: "", logo_url: "" }
          : { domain: p.domain ?? p.name ?? "", url: p.url ?? `https://${p.domain ?? ""}`, description: p.description ?? "", logo_url: p.logo_url ?? p.logo ?? "" }
      ).filter(p => p.domain);

      // Normalize related_domains — keep separate from partners
      const rawRelated = data.related_domains ?? data.siblings ?? [];
      const relatedDomains = rawRelated.map(r =>
        typeof r === "string"
          ? { domain: r, url: `https://${r}` }
          : { domain: r.domain ?? r.name ?? "", url: r.url ?? `https://${r.domain ?? ""}` }
      ).filter(r => r.domain);

      const info = {
        site_name:       data.site_name  ?? data.title       ?? titleCase(hostname),
        tagline:         data.tagline    ?? data.description  ?? DEFAULT.tagline,
        logo_url:        data.logo_url   ?? data.logo         ?? "",
        logo_html:       data.logo_html  ?? "",
        // Fall back to DEFAULT_PARTNERS when API returns no partner domains
        partner_domains: partnerDomains.length ? partnerDomains : DEFAULT_PARTNERS,
        related_domains: relatedDomains,
        brand_color:     data.vertical_color ?? data.brand_color ?? BRAND_COLOR_DEFAULT,
      };

      if (env.CACHE) {
        await env.CACHE.put(cacheKey, JSON.stringify(info), { expirationTtl: CACHE_TTL_DOMAIN });
      }
      return info;
    }
  } catch (_) {}

  return { ...DEFAULT, site_name: titleCase(hostname) };
}

// ─── Affiliate registration ───────────────────────────────────────────────────

async function getOrRegisterAffiliate(hostname, HANDYMAN_API, WORKER_KEY, env) {
  if (!env.CACHE) return null;
  const key    = `affiliate:${hostname}`;
  const cached = await env.CACHE.get(key);
  if (cached) return parseInt(cached, 10);

  try {
    const res = await fetch(`${HANDYMAN_API}/api/affiliate/register-domain`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ domain: hostname, apiKey: WORKER_KEY }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ref_id) {
        await env.CACHE.put(key, String(data.ref_id), { expirationTtl: CACHE_TTL_AFFILIATE });
        return data.ref_id;
      }
    }
  } catch (_) {}

  return null;
}

// ─── Handyman API fetches ─────────────────────────────────────────────────────

async function fetchProjects(HANDYMAN_API, env) {
  if (env.CACHE) {
    const c = await env.CACHE.get("hm:projects");
    if (c) return JSON.parse(c);
  }
  try {
    const res = await fetch(`${HANDYMAN_API}/api/public/projects?limit=6`);
    if (res.ok) {
      const data = await res.json();
      const list = data.projects ?? data ?? [];
      if (env.CACHE) await env.CACHE.put("hm:projects", JSON.stringify(list), { expirationTtl: CACHE_TTL });
      return list;
    }
  } catch (_) {}
  return [];
}

async function fetchQuestions(HANDYMAN_API, env) {
  if (env.CACHE) {
    const c = await env.CACHE.get("hm:questions");
    if (c) return JSON.parse(c);
  }
  try {
    const res = await fetch(`${HANDYMAN_API}/api/public/questions?limit=8`);
    if (res.ok) {
      const data = await res.json();
      const list = data.questions ?? data ?? [];
      if (env.CACHE) await env.CACHE.put("hm:questions", JSON.stringify(list), { expirationTtl: CACHE_TTL });
      return list;
    }
  } catch (_) {}
  return [];
}

async function fetchContribTasks(hostname, env) {
  if (env.CACHE) {
    const c = await env.CACHE.get(`contrib:tasks:${hostname}`);
    if (c) return JSON.parse(c);
  }
  try {
    // Endpoints tried in order: manage.vnoc.com (PHP, live now) → contrib.com Next.js (when deployed)
    const endpoints = [
      `https://manage.vnoc.com/v2/cfbuilder/get_contrib_tasks?domain=${encodeURIComponent(hostname)}&limit=6`,
      `https://www.contrib.com/api/public/domain_tasks?domain=${encodeURIComponent(hostname)}&limit=6`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, { headers: { Accept: "application/json" } });
        if (res.ok) {
          const data = await res.json();
          const list = data.tasks ?? data ?? [];
          if (Array.isArray(list) && list.length > 0) {
            if (env.CACHE) await env.CACHE.put(`contrib:tasks:${hostname}`, JSON.stringify(list), { expirationTtl: CACHE_TTL });
            return list;
          }
        }
      } catch (_) {}
    }

    // Final fallback: latest tasks from manage.vnoc.com (no domain filter)
    try {
      const res2 = await fetch(`https://manage.vnoc.com/v2/cfbuilder/get_contrib_tasks?limit=6`, {
        headers: { Accept: "application/json" }
      });
      if (res2.ok) {
        const data2 = await res2.json();
        const list2 = data2.tasks ?? data2 ?? [];
        if (Array.isArray(list2)) {
          if (env.CACHE) await env.CACHE.put(`contrib:tasks:${hostname}`, JSON.stringify(list2), { expirationTtl: CACHE_TTL });
          return list2;
        }
      }
    } catch (_) {}
  } catch (_) {}
  return [];
}

async function fetchContractors(HANDYMAN_API, env) {
  if (env.CACHE) {
    const c = await env.CACHE.get("hm:contractors");
    if (c) return JSON.parse(c);
  }
  try {
    const res = await fetch(`${HANDYMAN_API}/api/public/contractors?limit=6`);
    if (res.ok) {
      const data = await res.json();
      const list = data.contractors ?? data ?? [];
      if (env.CACHE) await env.CACHE.put("hm:contractors", JSON.stringify(list), { expirationTtl: CACHE_TTL });
      return list;
    }
  } catch (_) {}
  return [];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleCase(hostname) {
  return hostname
    .replace(/\.(com|net|org|io|co)$/, "")
    .replace(/[-_.]/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function timeAgo(dateStr) {
  try {
    const ms = Date.now() - new Date(dateStr).getTime();
    const m  = Math.floor(ms / 60000);
    if (m < 60)   return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24)   return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  } catch { return ""; }
}

// ─── Static pages (about / privacy / terms) ──────────────────────────────────

function renderStaticPage(type, hostname, domainInfo, HANDYMAN_API) {
  const year      = new Date().getFullYear();
  const siteName  = esc(domainInfo.site_name);
  const brandColor = domainInfo.brand_color ?? BRAND_COLOR_DEFAULT;

  const shell = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — ${siteName}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;background:#f5f4f2;color:#1a1a1a;line-height:1.7}
a{color:${brandColor};text-decoration:none}
a:hover{text-decoration:underline}
.bar{background:${brandColor};padding:0 24px;height:60px;display:flex;align-items:center;
     justify-content:space-between;position:sticky;top:0;z-index:100}
.bar-brand{color:#fff;font-weight:700;font-size:1rem;display:flex;align-items:center;gap:8px}
.bar-back{color:rgba(255,255,255,.8);font-size:.85rem;padding:7px 14px;border-radius:7px;
          background:rgba(255,255,255,.1);transition:background .2s}
.bar-back:hover{background:rgba(255,255,255,.2);text-decoration:none;color:#fff}
.wrap{max-width:760px;margin:48px auto;padding:0 24px 80px}
.prose h1{font-size:1.9rem;font-weight:800;margin-bottom:10px;line-height:1.2}
.prose h2{font-size:1.15rem;font-weight:700;margin:32px 0 10px;color:${brandColor}}
.prose p{margin-bottom:14px;font-size:.95rem;color:#374151}
.prose ul{margin:0 0 14px 20px}
.prose li{font-size:.95rem;color:#374151;margin-bottom:6px}
.prose .updated{font-size:.8rem;color:#9ca3af;margin-bottom:28px}
footer{background:#111;color:#6b7280;padding:20px 24px;text-align:center;font-size:.78rem;margin-top:0}
footer a{color:#FF9000}
</style>
</head>
<body>
<nav class="bar">
  <div class="bar-brand">🔨 ${siteName}</div>
  <a href="/" class="bar-back">← Back to Home</a>
</nav>
<div class="wrap"><div class="prose">${body}</div></div>
<footer>© ${year} ${siteName} · Powered by <a href="https://www.handyman.com" target="_blank">Handyman.com</a> &amp; <a href="https://vnoc.com" target="_blank">VNOC</a></footer>
</body></html>`;

  if (type === "about") {
    return shell("About", `
      <h1>About ${siteName}</h1>
      <p class="updated">Part of the Handyman.com Partner Network</p>
      <p><strong>${siteName}</strong> is a community resource for homeowners and contractors. We connect people who need home improvement work done with skilled, vetted professionals — and give the community a place to share projects, ask questions, and find answers.</p>
      <h2>What We Do</h2>
      <ul>
        <li>Showcase real home improvement projects in your area</li>
        <li>Host a Q&amp;A forum where homeowners and pros share knowledge</li>
        <li>Connect visitors with trusted, paid contractors on <a href="${esc(HANDYMAN_API)}" target="_blank">Handyman.com</a></li>
        <li>Help contractors grow their business through our partner referral program</li>
      </ul>
      <h2>The Network</h2>
      <p>This site is part of the <strong>Handyman.com Partner Network</strong>, operated by VNOC / VentureOS. Our network spans thousands of home improvement domains, all directing quality traffic to verified contractors.</p>
      <h2>For Contractors</h2>
      <p>Want to get featured on this site and others in our network? <a href="${esc(HANDYMAN_API)}/signup" target="_blank">Join Handyman.com as a contractor</a> and your profile will appear on partner domains in your service area.</p>
      <h2>For Domain Owners</h2>
      <p>Own a home improvement domain? <a href="${esc(HANDYMAN_API)}/partners" target="_blank">Apply to our partner program</a> and earn commission on every contractor signup you refer.</p>
      <h2>Contact</h2>
      <p>For partnership inquiries, visit <a href="${esc(HANDYMAN_API)}/partners" target="_blank">Handyman.com/partners</a>. For support, visit <a href="${esc(HANDYMAN_API)}/contact" target="_blank">Handyman.com/contact</a>.</p>
    `);
  }

  if (type === "privacy") {
    return shell("Privacy Policy", `
      <h1>Privacy Policy</h1>
      <p class="updated">Last updated: ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</p>
      <p>This Privacy Policy describes how <strong>${siteName}</strong> ("we", "us", or "our") collects, uses, and shares information when you visit <strong>${hostname}</strong> (the "Site").</p>
      <h2>Information We Collect</h2>
      <ul>
        <li><strong>Email address and name</strong> — if you subscribe to our newsletter or fill out a contact form</li>
        <li><strong>Usage data</strong> — pages visited, time on site, referral source (via Cloudflare analytics — no cookies required)</li>
        <li><strong>IP address</strong> — collected automatically for security and abuse prevention</li>
      </ul>
      <h2>How We Use Your Information</h2>
      <ul>
        <li>To send you home improvement tips and community updates (newsletter subscribers only)</li>
        <li>To connect you with contractors via <a href="${esc(HANDYMAN_API)}" target="_blank">Handyman.com</a></li>
        <li>To improve site content and user experience</li>
        <li>To prevent fraud and abuse</li>
      </ul>
      <h2>Cookies</h2>
      <p>This site uses minimal browser storage (localStorage) solely to remember your newsletter preference (whether you have dismissed the signup modal). We do not use advertising cookies or third-party tracking pixels.</p>
      <h2>Sharing Your Information</h2>
      <p>We do not sell your personal information. If you submit a form, your data is shared with the Handyman.com platform (operated by the same network) to facilitate contractor connections. We may share data with service providers who assist us in operating the site, subject to confidentiality agreements.</p>
      <h2>Data Retention</h2>
      <p>Newsletter subscriber emails are retained until you unsubscribe. You can request deletion at any time by contacting us via <a href="${esc(HANDYMAN_API)}/contact" target="_blank">Handyman.com/contact</a>.</p>
      <h2>Third-Party Links</h2>
      <p>This site links to Handyman.com and other partner sites. We are not responsible for the privacy practices of those sites. Please review their privacy policies separately.</p>
      <h2>Your Rights</h2>
      <p>Depending on your location, you may have rights to access, correct, or delete your personal data. To exercise these rights, contact us via <a href="${esc(HANDYMAN_API)}/contact" target="_blank">Handyman.com/contact</a>.</p>
      <h2>Changes</h2>
      <p>We may update this policy from time to time. The "last updated" date at the top reflects the most recent revision. Continued use of the site constitutes acceptance of the updated policy.</p>
    `);
  }

  if (type === "terms") {
    return shell("Terms of Use", `
      <h1>Terms of Use</h1>
      <p class="updated">Last updated: ${new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"})}</p>
      <p>By accessing or using <strong>${hostname}</strong> (the "Site"), you agree to be bound by these Terms of Use. If you do not agree, please do not use the Site.</p>
      <h2>Use of the Site</h2>
      <ul>
        <li>This Site is provided for informational purposes to connect homeowners with contractors</li>
        <li>You must be at least 18 years old to use this Site</li>
        <li>You agree not to use the Site for any unlawful or abusive purpose</li>
        <li>You agree not to scrape, copy, or redistribute content without written permission</li>
      </ul>
      <h2>Contractor Listings</h2>
      <p>Contractor profiles shown on this Site are sourced from <a href="${esc(HANDYMAN_API)}" target="_blank">Handyman.com</a>. We make no guarantee regarding the accuracy, quality, or availability of any contractor. Always verify contractor credentials independently before hiring.</p>
      <h2>Affiliate Relationships</h2>
      <p>This Site participates in the Handyman.com Partner Program. When you click a link and sign up as a contractor or homeowner, this site may receive a referral commission. This does not affect your cost or experience.</p>
      <h2>Intellectual Property</h2>
      <p>All content on this Site (text, design, code) is owned by or licensed to VNOC / VentureOS. You may not reproduce or distribute content without prior written consent.</p>
      <h2>Disclaimer of Warranties</h2>
      <p>The Site is provided "as is" without warranties of any kind, express or implied. We do not warrant that the Site will be uninterrupted, error-free, or free of harmful components.</p>
      <h2>Limitation of Liability</h2>
      <p>To the fullest extent permitted by law, we shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Site or any contractor services found through it.</p>
      <h2>Governing Law</h2>
      <p>These Terms are governed by the laws of the State of Delaware, USA, without regard to conflict of law principles.</p>
      <h2>Contact</h2>
      <p>For questions about these Terms, visit <a href="${esc(HANDYMAN_API)}/contact" target="_blank">Handyman.com/contact</a>.</p>
    `);
  }

  return shell("Page Not Found", `<h1>Page Not Found</h1><p><a href="/">Return to home →</a></p>`);
}

// ─── Contribute page renderer ─────────────────────────────────────────────────

function renderContributePage(hostname, domainInfo, tasks, HANDYMAN_API, signupLink) {
  const year       = new Date().getFullYear();
  const siteName   = esc(domainInfo.site_name);
  const brandColor = domainInfo.brand_color ?? BRAND_COLOR_DEFAULT;
  const contribUrl = `https://www.contrib.com/to/${hostname}`;

  const taskCards = tasks.length
    ? tasks.map(t => {
        const title   = esc((t.title ?? t.task_name ?? t.name ?? "Task").slice(0, 70));
        const desc    = esc((t.description ?? t.desc ?? "").slice(0, 120));
        const reward  = t.reward ?? t.pay ?? t.equity ?? null;
        const type    = esc(t.type ?? t.category ?? t.task_type ?? "Task");
        const taskUrl = t.url ?? `${contribUrl}`;
        const status  = t.status ?? "open";
        const badgeColor = status === "open" ? "#dcfce7" : "#fef3c7";
        const badgeText  = status === "open" ? "#166534" : "#92400e";
        return `
      <div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:14px;padding:20px 22px;
                  transition:all .25s" onmouseover="this.style.borderColor='${brandColor}';this.style.boxShadow='0 6px 24px rgba(0,0,0,.1)'"
                  onmouseout="this.style.borderColor='#e5e7eb';this.style.boxShadow='none'">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:10px">
          <div>
            <span style="background:#f0f4ff;color:#3730a3;font-size:.7rem;font-weight:700;padding:3px 10px;border-radius:100px;text-transform:uppercase;letter-spacing:.05em">${type}</span>
            <span style="background:${badgeColor};color:${badgeText};font-size:.7rem;font-weight:700;padding:3px 10px;border-radius:100px;margin-left:6px">${esc(status)}</span>
          </div>
          ${reward ? `<div style="font-weight:800;color:${brandColor};font-size:.95rem;white-space:nowrap">${esc(String(reward))}</div>` : ""}
        </div>
        <div style="font-weight:700;font-size:1rem;margin-bottom:6px;line-height:1.3">${title}</div>
        ${desc ? `<div style="font-size:.83rem;color:#6b7280;line-height:1.5;margin-bottom:14px">${desc}${(t.description ?? "").length > 120 ? "…" : ""}</div>` : ""}
        <a href="${esc(taskUrl)}" target="_blank" rel="noopener"
           style="display:inline-block;background:${brandColor};color:#fff;padding:9px 20px;
                  border-radius:8px;font-size:.83rem;font-weight:700">View Task →</a>
      </div>`;
      }).join("")
    : `<div style="text-align:center;padding:48px 20px;background:#fff;border-radius:14px;border:2px dashed #e5e7eb">
        <div style="font-size:3rem;margin-bottom:12px">🚀</div>
        <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:8px">Be the First Contributor</h3>
        <p style="color:#6b7280;font-size:.9rem;margin-bottom:18px">No tasks posted yet for ${esc(hostname)}. Post the first one on contrib.com!</p>
        <a href="${esc(contribUrl)}" target="_blank" rel="noopener"
           style="display:inline-block;background:${brandColor};color:#fff;padding:11px 24px;
                  border-radius:9px;font-weight:700;font-size:.9rem">Start on Contrib.com →</a>
      </div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contribute to ${siteName}</title>
<meta name="description" content="Help build ${siteName} — find tasks, contribute skills, and earn equity or rewards on Contrib.com">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;background:#f5f4f2;color:#1a1a1a;line-height:1.6}
a{text-decoration:none;color:inherit}
.navbar{position:sticky;top:0;z-index:100;background:rgba(103,7,8,.97);backdrop-filter:blur(12px);
        border-bottom:1px solid rgba(255,255,255,.08);padding:0 24px;height:64px;
        display:flex;align-items:center;justify-content:space-between}
.navbar-brand{color:#fff;font-weight:700;font-size:1.05rem;display:flex;align-items:center;gap:10px}
.nav-btn{background:#FF9000;color:#fff;padding:9px 22px;border-radius:8px;font-weight:600;font-size:.88rem}
.hero{background:linear-gradient(135deg,${brandColor} 0%,#1a0000 100%);padding:72px 24px 60px;text-align:center}
.hero-badge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);
            border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.9);
            padding:6px 16px;border-radius:100px;font-size:.8rem;font-weight:500;margin-bottom:18px}
.hero h1{font-size:clamp(1.8rem,4vw,3rem);font-weight:900;color:#fff;line-height:1.1;
         margin-bottom:12px;letter-spacing:-.02em}
.hero h1 span{color:#FF9000}
.hero p{color:rgba(255,255,255,.8);font-size:1rem;max-width:520px;margin:0 auto 28px;line-height:1.5}
.btn-primary{display:inline-block;background:#FF9000;color:#fff;padding:14px 32px;border-radius:10px;
             font-weight:700;font-size:.95rem;box-shadow:0 4px 20px rgba(255,144,0,.4);transition:all .2s}
.btn-primary:hover{background:#e07800;transform:translateY(-1px)}
.btn-outline{display:inline-block;background:rgba(255,255,255,.12);color:#fff;padding:14px 28px;
             border-radius:10px;font-weight:600;font-size:.9rem;border:1px solid rgba(255,255,255,.25);
             transition:all .2s;margin-left:12px}
.btn-outline:hover{background:rgba(255,255,255,.22)}
.wrap{max-width:900px;margin:0 auto;padding:48px 24px 80px}
.how-it-works{background:#fff;border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;
              padding:56px 24px}
.how-inner{max-width:900px;margin:0 auto}
.steps{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:24px;margin-top:32px}
.step{text-align:center;padding:24px 16px}
.step-num{width:44px;height:44px;background:${brandColor};color:#fff;border-radius:50%;
          display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.1rem;
          margin:0 auto 14px}
.step-title{font-weight:700;font-size:.95rem;margin-bottom:6px}
.step-desc{font-size:.82rem;color:#6b7280;line-height:1.5}
.tasks-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-bottom:40px}
.cta-box{background:linear-gradient(135deg,${brandColor},#3a0000);border-radius:18px;
         padding:40px 36px;text-align:center;color:#fff;margin-bottom:40px}
.cta-box h2{font-size:1.6rem;font-weight:900;margin-bottom:10px}
.cta-box p{opacity:.85;font-size:.95rem;margin-bottom:24px;line-height:1.5;max-width:500px;margin-left:auto;margin-right:auto}
footer{background:#111;color:#6b7280;padding:28px 24px;text-align:center;font-size:.8rem}
footer a{color:#FF9000}
.footer-links{display:flex;justify-content:center;gap:20px;margin-bottom:10px;flex-wrap:wrap}
@media(max-width:600px){.btn-outline{margin-left:0;margin-top:10px}.hero{padding:56px 18px 48px}}
</style>
</head>
<body>
<nav class="navbar">
  <div class="navbar-brand">
    ${domainInfo.logo_html || (domainInfo.logo_url ? `<img src="${esc(domainInfo.logo_url)}" alt="${siteName}" style="height:30px;object-fit:contain">` : `<span style="background:#FF9000;width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;font-size:1.1rem">🔨</span>`)}
    <span>${siteName}</span>
  </div>
  <div style="display:flex;gap:10px;align-items:center">
    <a href="/" style="color:rgba(255,255,255,.75);font-size:.88rem;padding:7px 14px;border-radius:7px;transition:all .2s" onmouseover="this.style.background='rgba(255,255,255,.1)'" onmouseout="this.style.background='transparent'">← Home</a>
    <a href="${esc(signupLink)}" class="nav-btn">Join Free</a>
  </div>
</nav>

<section class="hero">
  <div class="hero-badge">🤝 Community Contributions</div>
  <h1>Contribute to<br><span>${esc(hostname.replace(/\.(com|net|org|io)$/, "").replace(/[-_.]/g, " "))}</span></h1>
  <p>Help shape this community. Complete tasks, contribute skills, and earn rewards or equity through Contrib.com.</p>
  <div>
    <a href="${esc(contribUrl)}" target="_blank" class="btn-primary">View All Tasks on Contrib.com →</a>
    <a href="${esc(signupLink)}"                 class="btn-outline">Join Handyman.com Free</a>
  </div>
</section>

<div class="how-it-works">
  <div class="how-inner">
    <div style="text-align:center;margin-bottom:8px;font-size:.75rem;font-weight:700;color:${brandColor};text-transform:uppercase;letter-spacing:.08em">How It Works</div>
    <h2 style="text-align:center;font-size:1.6rem;font-weight:800">Contribute &amp; Earn</h2>
    <div class="steps">
      <div class="step"><div class="step-num">1</div><div class="step-title">Browse Tasks</div><div class="step-desc">Find open tasks for ${esc(hostname)} or discover new opportunities on Contrib.com</div></div>
      <div class="step"><div class="step-num">2</div><div class="step-title">Apply to Contribute</div><div class="step-desc">Submit your skills, proposal, or work sample to the task owner</div></div>
      <div class="step"><div class="step-num">3</div><div class="step-title">Complete the Work</div><div class="step-desc">Collaborate, deliver quality work, and get it approved</div></div>
      <div class="step"><div class="step-num">4</div><div class="step-title">Earn Rewards</div><div class="step-desc">Get paid in cash, equity, or credits — your choice</div></div>
    </div>
  </div>
</div>

<div class="wrap">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
    <div>
      <div style="font-size:.72rem;font-weight:700;color:${brandColor};text-transform:uppercase;letter-spacing:.08em;margin-bottom:4px">
        ${tasks.length > 0 ? `${tasks.length} Open Task${tasks.length !== 1 ? "s" : ""}` : "Discover Opportunities"}
      </div>
      <h2 style="font-size:1.4rem;font-weight:800">
        ${tasks.length > 0 ? `Tasks for ${esc(hostname)}` : "Latest Tasks on Contrib.com"}
      </h2>
    </div>
    <a href="${esc(contribUrl)}" target="_blank"
       style="font-size:.85rem;font-weight:600;color:${brandColor};padding:9px 18px;
              border-radius:8px;border:1.5px solid ${brandColor};transition:all .2s"
       onmouseover="this.style.background='${brandColor}';this.style.color='#fff'"
       onmouseout="this.style.background='transparent';this.style.color='${brandColor}'">
      View All on Contrib.com →
    </a>
  </div>

  <div class="tasks-grid">${taskCards}</div>

  <div class="cta-box">
    <h2>🚀 Ready to Contribute?</h2>
    <p>Join thousands of contributors building startups and communities on Contrib.com. Earn equity, cash, or credits for your skills.</p>
    <a href="${esc(contribUrl)}" target="_blank"
       style="display:inline-block;background:#FF9000;color:#fff;padding:14px 32px;
              border-radius:10px;font-weight:700;font-size:.95rem;margin-right:12px;transition:background .2s"
       onmouseover="this.style.background='#e07800'" onmouseout="this.style.background='#FF9000'">
      Start Contributing →
    </a>
    <a href="${esc(HANDYMAN_API)}/signup" target="_blank"
       style="display:inline-block;background:rgba(255,255,255,.15);color:#fff;padding:14px 28px;
              border-radius:10px;font-weight:600;font-size:.9rem;border:1px solid rgba(255,255,255,.3);transition:background .2s"
       onmouseover="this.style.background='rgba(255,255,255,.25)'" onmouseout="this.style.background='rgba(255,255,255,.15)'">
      Join Handyman.com
    </a>
  </div>
</div>

<footer>
  <div class="footer-links">
    <a href="/">Home</a>
    <a href="${esc(HANDYMAN_API)}" target="_blank">Handyman.com</a>
    <a href="${esc(contribUrl)}" target="_blank">Contrib.com</a>
    <a href="/about">About</a>
    <a href="/privacy">Privacy</a>
    <a href="/terms">Terms</a>
  </div>
  <p>© ${year} ${siteName} · Powered by <a href="https://www.handyman.com" target="_blank">Handyman.com</a> &amp; <a href="https://vnoc.com" target="_blank">VNOC</a></p>
</footer>
</body></html>`;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function buildPartnerSection(partners, HANDYMAN_API, refSlug) {
  if (!partners || partners.length === 0) return "";

  const cards = partners.map(p => {
    // Logo with fallback chain: domain logo → Google favicon → letter avatar
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(p.domain)}&sz=64`;
    const letterAvatar = `<div style="width:40px;height:40px;background:var(--brand);border-radius:9px;
                    display:flex;align-items:center;justify-content:center;
                    color:#fff;font-weight:800;font-size:1.1rem;margin-bottom:8px;flex-shrink:0">
           ${esc(p.domain.charAt(0).toUpperCase())}
         </div>`;
    const logoHtml = p.logo_url
      ? `<img src="${esc(p.logo_url)}" alt="${esc(p.domain)}"
              style="height:32px;max-width:120px;object-fit:contain;margin-bottom:8px"
              onerror="this.onerror=null;this.src='${faviconUrl}';this.style.height='32px';this.style.width='32px'">`
      : `<img src="${esc(faviconUrl)}" alt="${esc(p.domain)}"
              style="height:32px;width:32px;object-fit:contain;margin-bottom:8px"
              onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`;
    const desc = p.description
      ? `<p style="font-size:.75rem;color:var(--muted);margin:4px 0 0;line-height:1.4">${esc(p.description.slice(0, 60))}${p.description.length > 60 ? "…" : ""}</p>`
      : "";
    return `
    <a href="${esc(p.url)}" class="partner-card" target="_blank" rel="noopener">
      ${logoHtml}
      <div style="font-size:.82rem;font-weight:700;color:var(--text)">${esc(p.domain)}</div>
      ${desc}
      <div style="margin-top:8px;font-size:.72rem;color:var(--brand);font-weight:600">Visit Site →</div>
    </a>`;
  }).join("");

  return `
<section class="partners-section">
  <div class="section-inner">
    <div class="section-header">
      <div>
        <div class="section-eyebrow">🤝 Network</div>
        <h2 class="section-title">Partner Sites</h2>
      </div>
      <a href="${esc(HANDYMAN_API)}/partners" class="section-link">View All Partners →</a>
    </div>
    <div class="partners-grid">${cards}</div>
  </div>
</section>`;
}

function buildRelatedSection(related) {
  if (!related || related.length === 0) return "";

  const tags = related.map(r => {
    const domain = typeof r === "string" ? r : (r.domain ?? "");
    const url    = typeof r === "string" ? `https://${r}` : (r.url ?? `https://${r.domain ?? ""}`);
    return domain
      ? `<a href="${esc(url)}" class="rel-tag" target="_blank" rel="noopener">${esc(domain)}</a>`
      : "";
  }).filter(Boolean).join("");

  if (!tags) return "";

  return `
<section class="related-section">
  <div class="section-inner">
    <div class="section-header">
      <div>
        <div class="section-eyebrow">🔗 Discover</div>
        <h2 class="section-title">Related Domains</h2>
      </div>
    </div>
    <div class="rel-tags">${tags}</div>
  </div>
</section>`;
}

function buildHandymanSection(HANDYMAN_API, signupLink) {
  const features = [
    { icon: "🔨", title: "5,000+ Verified Pros",   desc: "Vetted, reviewed handymen in your area" },
    { icon: "📋", title: "Post a Project",          desc: "Get quotes from multiple contractors" },
    { icon: "💬", title: "Community Q&A",           desc: "Real answers from real homeowners & pros" },
    { icon: "⭐", title: "Trusted Reviews",          desc: "Honest ratings from real customers" },
    { icon: "💰", title: "Earn Referral Credits",   desc: "Refer a contractor, earn when they sign up" },
    { icon: "🛠️", title: "All Home Services",       desc: "Plumbing, electrical, roofing & more" },
  ];

  const featureCards = features.map(f => `
    <div class="hm-feature">
      <div class="hm-feature-icon">${f.icon}</div>
      <div>
        <div style="font-weight:700;font-size:.9rem;margin-bottom:3px">${f.title}</div>
        <div style="font-size:.78rem;color:var(--muted)">${f.desc}</div>
      </div>
    </div>`).join("");

  return `
<section class="handyman-section">
  <div class="section-inner">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center">

      <!-- Left: copy -->
      <div>
        <div class="section-eyebrow" style="color:var(--orange)">🏠 The Platform</div>
        <h2 style="font-size:clamp(1.6rem,3vw,2.4rem);font-weight:900;line-height:1.15;margin:10px 0 14px">
          Everything Home Improvement<br>in One Place
        </h2>
        <p style="color:var(--muted);font-size:.95rem;line-height:1.6;margin-bottom:24px;max-width:400px">
          Handyman.com connects homeowners with trusted, vetted contractors.
          Post projects, get quotes, read community answers — all free.
        </p>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          <a href="${esc(signupLink)}"
             style="background:var(--brand);color:#fff;padding:13px 28px;border-radius:9px;
                    font-weight:700;font-size:.9rem;transition:background .2s"
             onmouseover="this.style.background='#4a0505'"
             onmouseout="this.style.background='var(--brand)'">Join Free →</a>
          <a href="${esc(HANDYMAN_API)}/contractors"
             style="background:#fff;color:var(--brand);padding:13px 28px;border-radius:9px;
                    font-weight:700;font-size:.9rem;border:2px solid var(--brand);transition:all .2s"
             onmouseover="this.style.background='var(--brand)';this.style.color='#fff'"
             onmouseout="this.style.background='#fff';this.style.color='var(--brand)'">Find Contractors</a>
        </div>
      </div>

      <!-- Right: feature grid -->
      <div class="hm-features-grid">${featureCards}</div>

    </div>
  </div>
</section>`;
}

// ─── Page renderer ────────────────────────────────────────────────────────────

function renderPage({ hostname, domainInfo, signupLink, referLink, projects, questions, contractors, HANDYMAN_API }) {
  const year       = new Date().getFullYear();
  const brandColor = domainInfo.brand_color ?? BRAND_COLOR_DEFAULT;
  const siteName   = esc(domainInfo.site_name);
  const metaDesc   = esc(domainInfo.tagline);
  const refSlug    = hostname.replace(/\./g, "-");

  // Section HTML
  const partnerSectionHtml = buildPartnerSection(domainInfo.partner_domains, HANDYMAN_API, refSlug);
  const relatedSectionHtml = buildRelatedSection(domainInfo.related_domains);
  const handymanSectionHtml = buildHandymanSection(HANDYMAN_API, signupLink);

  // Project cards
  const typeColors = {
    Plumbing:   "#0369a1",
    Electrical: "#b45309",
    Roofing:    "#166534",
    Painting:   "#7c3aed",
    HVAC:       "#0891b2",
    General:    "#6b7280",
  };

  const projectCards = projects.length
    ? projects.map(p => {
        const typeName = p.projectType ?? p.project_type ?? "General";
        const tColor   = typeColors[typeName] ?? "#6b7280";
        const ago      = timeAgo(p.date_added ?? p.createdAt ?? "");
        const loc      = [p.city, p.state].filter(Boolean).join(", ");
        const detailUrl = `${HANDYMAN_API}/projects/${p.project_id ?? p.id}?ref=${refSlug}`;
        return `
        <a href="${esc(detailUrl)}" class="project-card" target="_blank" rel="noopener">
          <div class="project-type" style="color:${tColor};background:${tColor}18">${esc(typeName)}</div>
          <div class="project-title">${esc((p.description ?? p.title ?? "Untitled Project").slice(0, 80))}</div>
          <div class="project-meta">
            ${loc  ? `<span>📍 ${esc(loc)}</span>`   : ""}
            ${ago  ? `<span>🕐 ${ago}</span>`         : ""}
            ${p.budget ? `<span>💰 ${esc(p.budget)}</span>` : ""}
          </div>
        </a>`;
      }).join("")
    : `<div class="empty-state">
        <div style="font-size:2.5rem">🏗️</div>
        <h3>No Projects Yet</h3>
        <p>Be the first to post a project in your area.</p>
        <a href="${esc(HANDYMAN_API)}/projects/post" class="btn-empty">Post a Project →</a>
      </div>`;

  // Question cards
  const questionCards = questions.length
    ? questions.map(q => {
        const votes   = q.votes ?? 0;
        const answers = q.answer_count ?? 0;
        const qUrl    = `${HANDYMAN_API}/questions/${q.question_id ?? q.id}?ref=${refSlug}`;
        const ago     = timeAgo(q.date_posted ?? "");
        const preview = (q.title ?? q.question_text ?? q.content ?? "").slice(0, 95);
        return `
        <a href="${esc(qUrl)}" class="q-card" target="_blank" rel="noopener">
          <div class="q-votes">
            <div class="q-vote-num">${votes}</div>
            <div class="q-vote-lbl">votes</div>
          </div>
          <div class="q-body">
            <div class="q-title">${esc(preview)}${preview.length >= 95 ? "…" : ""}</div>
            <div class="q-meta">
              ${answers > 0
                ? `<span class="q-answered">✓ ${answers} answer${answers !== 1 ? "s" : ""}</span>`
                : `<span class="q-unanswered">Unanswered</span>`}
              ${ago ? `<span class="q-time">${ago}</span>` : ""}
            </div>
          </div>
          <div class="q-arrow">›</div>
        </a>`;
      }).join("")
    : `<div class="empty-state">
        <div style="font-size:2.5rem">💬</div>
        <h3>Be First to Ask</h3>
        <p>Have a home improvement question? Our community has answers.</p>
        <a href="${esc(HANDYMAN_API)}/questions" class="btn-empty">Ask a Question →</a>
      </div>`;

  // Service tags in sidebar
  const serviceTags = ["Plumbing","Electrical","Roofing","Painting","HVAC","Landscaping","Bathrooms","Windows"]
    .map(s => `<a href="${esc(HANDYMAN_API)}/services/${s.toLowerCase()}?ref=${refSlug}"
         class="svc-tag">${s}</a>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${siteName} — Projects &amp; Community</title>
<meta name="description" content="${metaDesc}">
<meta property="og:title" content="${siteName} — Projects &amp; Community">
<meta property="og:description" content="${metaDesc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{
  --brand:${brandColor};
  --orange:${ACCENT_COLOR};
  --bg:#f5f4f2;
  --card-bg:#fff;
  --text:#1a1a1a;
  --muted:#6b7280;
  --border:#e5e7eb;
  --radius:14px;
  --shadow:0 2px 16px rgba(0,0,0,.07);
  --shadow-lg:0 6px 32px rgba(0,0,0,.12);
}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{text-decoration:none;color:inherit}

/* Navbar */
.navbar{position:sticky;top:0;z-index:100;background:rgba(103,7,8,.97);backdrop-filter:blur(12px);
        border-bottom:1px solid rgba(255,255,255,.08);padding:0 24px;height:64px;
        display:flex;align-items:center;justify-content:space-between}
.navbar-brand{display:flex;align-items:center;gap:10px;color:#fff;font-size:1.1rem;font-weight:700}
.navbar-brand .icon{width:34px;height:34px;background:var(--orange);border-radius:8px;
                    display:flex;align-items:center;justify-content:center;font-size:1.1rem}
.nav-actions{display:flex;gap:10px;align-items:center}
.nav-link{color:rgba(255,255,255,.75);font-size:.88rem;font-weight:500;padding:7px 14px;border-radius:7px;transition:all .2s}
.nav-link:hover{color:#fff;background:rgba(255,255,255,.1)}
.nav-btn{background:var(--orange);color:#fff;padding:9px 22px;border-radius:8px;
         font-weight:600;font-size:.88rem;white-space:nowrap;transition:background .2s}
.nav-btn:hover{background:#e07800}

/* Hero */
.hero{background:var(--brand);padding:80px 24px 0;text-align:center;overflow:hidden}
.hero-badge{display:inline-flex;align-items:center;gap:6px;
            background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);
            color:rgba(255,255,255,.9);padding:6px 16px;border-radius:100px;
            font-size:.8rem;font-weight:500;margin-bottom:18px}
.hero h1{font-size:clamp(1.9rem,4.5vw,3.2rem);font-weight:900;color:#fff;
         line-height:1.1;letter-spacing:-.02em;margin-bottom:14px;
         max-width:700px;margin-left:auto;margin-right:auto}
.hero h1 span{color:var(--orange)}
.hero p{color:rgba(255,255,255,.8);font-size:1rem;max-width:500px;margin:0 auto 28px}
.hero-btns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:40px}
.btn-hero-p{background:var(--orange);color:#fff;padding:14px 32px;border-radius:10px;
            font-weight:700;font-size:.95rem;box-shadow:0 4px 20px rgba(255,144,0,.4);transition:all .2s}
.btn-hero-p:hover{background:#e07800;transform:translateY(-1px)}
.btn-hero-s{background:rgba(255,255,255,.12);color:#fff;padding:14px 32px;border-radius:10px;
            font-weight:600;font-size:.95rem;border:1px solid rgba(255,255,255,.25);transition:all .2s}
.btn-hero-s:hover{background:rgba(255,255,255,.2)}

/* Tabs */
.tabs-bar{background:#fff;border-bottom:1px solid var(--border);position:sticky;top:64px;z-index:90}
.tabs-inner{max-width:1100px;margin:0 auto;padding:0 24px;display:flex;gap:4px}
.tab{padding:14px 20px;font-weight:600;font-size:.88rem;color:var(--muted);
     border-bottom:3px solid transparent;cursor:pointer;transition:all .2s;white-space:nowrap}
.tab.active{color:var(--brand);border-bottom-color:var(--brand)}
.tab:hover{color:var(--brand)}

/* Layout */
.content{max-width:1100px;margin:0 auto;padding:40px 24px;
         display:grid;grid-template-columns:1fr 340px;gap:28px;align-items:start}

/* Project cards */
.projects-list{display:flex;flex-direction:column;gap:14px}
.project-card{background:var(--card-bg);border-radius:var(--radius);box-shadow:var(--shadow);
              padding:20px 22px;transition:all .25s;border:1px solid var(--border);display:block}
.project-card:hover{transform:translateY(-2px);box-shadow:var(--shadow-lg);border-color:#ddd}
.project-type{display:inline-block;font-size:.72rem;font-weight:700;padding:3px 10px;
              border-radius:100px;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em}
.project-title{font-size:.95rem;font-weight:600;color:var(--text);margin-bottom:10px;line-height:1.4}
.project-meta{display:flex;gap:14px;flex-wrap:wrap}
.project-meta span{font-size:.78rem;color:var(--muted)}

/* Q cards */
.questions-list{display:flex;flex-direction:column;gap:2px;background:var(--card-bg);
                border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;
                border:1px solid var(--border)}
.q-card{display:flex;align-items:center;gap:14px;padding:16px 18px;
        border-bottom:1px solid var(--border);transition:background .2s;cursor:pointer}
.q-card:last-child{border-bottom:none}
.q-card:hover{background:#fafafa}
.q-votes{min-width:48px;text-align:center}
.q-vote-num{font-size:1.1rem;font-weight:800;color:var(--brand)}
.q-vote-lbl{font-size:.65rem;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
.q-body{flex:1;min-width:0}
.q-title{font-size:.88rem;font-weight:600;color:var(--text);line-height:1.4;margin-bottom:5px}
.q-meta{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.q-answered{background:#dcfce7;color:#166534;font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:100px}
.q-unanswered{background:#fef3c7;color:#92400e;font-size:.7rem;font-weight:600;padding:2px 8px;border-radius:100px}
.q-time{font-size:.72rem;color:var(--muted)}
.q-arrow{color:var(--muted);font-size:1.3rem;font-weight:300}

/* Sidebar */
.sidebar{display:flex;flex-direction:column;gap:18px}
.sidebar-card{background:var(--card-bg);border-radius:var(--radius);box-shadow:var(--shadow);
              padding:22px;border:1px solid var(--border)}
.sidebar-title{font-size:.85rem;font-weight:700;color:var(--text);
               text-transform:uppercase;letter-spacing:.06em;margin-bottom:14px}
.cta-sidebar{background:linear-gradient(135deg,var(--brand),#3a0000);color:#fff;
             border-radius:var(--radius);padding:24px;text-align:center}
.cta-sidebar h3{font-size:1.05rem;font-weight:700;margin-bottom:8px}
.cta-sidebar p{font-size:.82rem;opacity:.85;margin-bottom:16px;line-height:1.4}
.btn-sidebar{display:block;background:var(--orange);color:#fff;padding:11px 20px;
             border-radius:8px;font-weight:700;font-size:.85rem;text-align:center;transition:background .2s}
.btn-sidebar:hover{background:#e07800}
.stat-row{display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}
.stat-row:last-child{border-bottom:none}
.stat-row-lbl{font-size:.82rem;color:var(--muted)}
.stat-row-val{font-size:.82rem;font-weight:700;color:var(--text)}
.ask-btn{display:block;background:var(--brand);color:#fff;padding:11px 20px;border-radius:8px;
         font-weight:700;font-size:.85rem;text-align:center;transition:background .2s;margin-bottom:10px}
.ask-btn:hover{background:#4a0505}
.post-btn{display:block;background:var(--orange);color:#fff;padding:11px 20px;border-radius:8px;
          font-weight:700;font-size:.85rem;text-align:center;transition:background .2s}
.post-btn:hover{background:#e07800}
.svc-tag{background:#f5f4f2;color:var(--muted);padding:5px 12px;border-radius:100px;
         font-size:.75rem;font-weight:500;border:1px solid var(--border);
         display:inline-block;margin:3px;transition:all .2s}
.svc-tag:hover{background:var(--brand);color:#fff;border-color:var(--brand)}

/* Contractor cards in Find Contractors panel */
.ctr-card{background:var(--card-bg);border:1.5px solid var(--border);border-radius:12px;
          padding:16px 18px;transition:all .25s;display:block}
.ctr-card:hover{border-color:var(--brand);box-shadow:var(--shadow-lg);transform:translateY(-2px)}

/* Empty state */
.empty-state{background:var(--card-bg);border-radius:var(--radius);padding:40px;
             text-align:center;border:2px dashed var(--border)}
.empty-state h3{font-size:1rem;font-weight:700;margin:10px 0 6px}
.empty-state p{font-size:.85rem;color:var(--muted);margin-bottom:16px}
.btn-empty{display:inline-block;background:var(--brand);color:#fff;padding:9px 20px;
           border-radius:7px;font-size:.85rem;font-weight:600}

/* Refer banner */
.refer-section{background:#fff;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.refer-inner{max-width:1100px;margin:0 auto;padding:48px 24px;
             display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap}
.refer-text h2{font-size:1.4rem;font-weight:800;margin-bottom:8px}
.refer-text p{color:var(--muted);max-width:440px;font-size:.9rem}
.refer-action{display:flex;flex-direction:column;gap:8px;min-width:220px}
.btn-refer{background:var(--brand);color:#fff;padding:12px 28px;border-radius:9px;
           font-weight:700;font-size:.9rem;text-align:center;transition:all .2s}
.btn-refer:hover{background:#4a0505}

/* Section shared styles */
.section-inner{max-width:1100px;margin:0 auto;padding:56px 24px}
.section-header{display:flex;align-items:flex-end;justify-content:space-between;
                margin-bottom:28px;flex-wrap:wrap;gap:12px}
.section-eyebrow{font-size:.72rem;font-weight:700;color:var(--brand);
                 text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px}
.section-title{font-size:1.6rem;font-weight:800;line-height:1.15}
.section-link{font-size:.85rem;font-weight:600;color:var(--brand);
              padding:8px 16px;border-radius:7px;border:1px solid var(--brand);transition:all .2s}
.section-link:hover{background:var(--brand);color:#fff}

/* Partner domains section */
.partners-section{background:#fff;border-top:1px solid var(--border)}
.partners-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px}
.partner-card{background:#f9f9f9;border:1px solid var(--border);border-radius:12px;
              padding:18px 16px;transition:all .25s;display:flex;flex-direction:column}
.partner-card:hover{transform:translateY(-3px);box-shadow:var(--shadow-lg);
                    border-color:var(--brand);background:#fff}

/* Related domains section */
.related-section{background:var(--bg);border-top:1px solid var(--border)}
.rel-tags{display:flex;flex-wrap:wrap;gap:8px}
.rel-tag{background:#fff;border:1px solid var(--border);color:var(--muted);
         padding:7px 16px;border-radius:100px;font-size:.82rem;font-weight:500;transition:all .2s}
.rel-tag:hover{background:var(--brand);color:#fff;border-color:var(--brand)}

/* Handyman.com section */
.handyman-section{background:linear-gradient(135deg,#fdf6f0 0%,#fff 60%,#fdf0f0 100%);
                  border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.hm-features-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.hm-feature{display:flex;align-items:flex-start;gap:12px;
            background:#fff;border:1px solid var(--border);border-radius:10px;padding:14px}
.hm-feature-icon{font-size:1.4rem;flex-shrink:0;margin-top:2px}

/* Footer */
footer{background:#111;color:#6b7280;padding:28px 24px;text-align:center;font-size:.8rem}
footer a{color:var(--orange)}
.footer-links{display:flex;justify-content:center;gap:20px;margin-bottom:10px;flex-wrap:wrap}

/* Newsletter modal */
.nl-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9000;
            display:flex;align-items:center;justify-content:center;padding:20px;
            opacity:0;transition:opacity .3s;pointer-events:none}
.nl-overlay.show{opacity:1;pointer-events:all}
.nl-box{background:#fff;border-radius:20px;max-width:460px;width:100%;
        box-shadow:0 24px 80px rgba(0,0,0,.25);overflow:hidden;
        transform:translateY(24px) scale(.97);transition:transform .3s}
.nl-overlay.show .nl-box{transform:translateY(0) scale(1)}
.nl-top{background:linear-gradient(135deg,var(--brand) 0%,#3a0000 100%);
        padding:32px 28px 24px;position:relative;text-align:center}
.nl-close{position:absolute;top:14px;right:16px;background:rgba(255,255,255,.15);
          border:none;color:#fff;width:30px;height:30px;border-radius:50%;
          font-size:1.1rem;cursor:pointer;line-height:30px;padding:0;transition:background .2s}
.nl-close:hover{background:rgba(255,255,255,.3)}
.nl-icon{font-size:2.4rem;margin-bottom:10px}
.nl-top h2{color:#fff;font-size:1.35rem;font-weight:800;margin-bottom:6px}
.nl-top p{color:rgba(255,255,255,.8);font-size:.88rem;line-height:1.5}
.nl-body{padding:24px 28px 28px}
.nl-input{width:100%;padding:12px 16px;border:1.5px solid var(--border);border-radius:9px;
          font-size:.92rem;font-family:inherit;margin-bottom:10px;transition:border-color .2s;box-sizing:border-box}
.nl-input:focus{outline:none;border-color:var(--brand)}
.nl-submit{width:100%;background:var(--brand);color:#fff;border:none;padding:13px;
           border-radius:9px;font-weight:700;font-size:.95rem;cursor:pointer;transition:background .2s}
.nl-submit:hover{background:#4a0505}
.nl-msg{margin-top:10px;padding:10px 14px;border-radius:7px;font-size:.85rem;display:none;text-align:center}
.nl-msg.ok{background:#dcfce7;color:#166534}
.nl-msg.err{background:#fee2e2;color:#991b1b}
.nl-skip{display:block;text-align:center;margin-top:12px;font-size:.78rem;
         color:var(--muted);cursor:pointer;text-decoration:underline}
.nl-skip:hover{color:var(--brand)}

@media(max-width:860px){
  .content{grid-template-columns:1fr}
  .sidebar{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .hm-features-grid{grid-template-columns:1fr}
  .handyman-section .section-inner > div{grid-template-columns:1fr!important}
}
@media(max-width:600px){
  .hero{padding:56px 18px 0}
  .tabs-inner{gap:0;overflow-x:auto}
  .navbar .nav-link{display:none}
  .refer-inner{flex-direction:column;text-align:center}
  .refer-action{width:100%}
  .sidebar{grid-template-columns:1fr}
  .partners-grid{grid-template-columns:repeat(auto-fill,minmax(140px,1fr))}
}
</style>
</head>
<body>

<!-- Navbar -->
<nav class="navbar">
  <div class="navbar-brand">
    ${domainInfo.logo_html
      ? domainInfo.logo_html
      : domainInfo.logo_url
        ? `<img src="${esc(domainInfo.logo_url)}" alt="${siteName}" style="height:32px;object-fit:contain">`
        : `<div class="icon">🔨</div>`}
    <span>${siteName}</span>
  </div>
  <div class="nav-actions">
    <a href="${esc(HANDYMAN_API)}/contractors" class="nav-link">Find Pros</a>
    <a href="${esc(HANDYMAN_API)}/questions"   class="nav-link">Community</a>
    <a href="${esc(signupLink)}"               class="nav-btn">Join Free</a>
  </div>
</nav>

<!-- Hero -->
<section class="hero">
  <div class="hero-badge">💬 Active Community · Real Projects</div>
  <h1>Real Projects.<br><span>Real Answers.</span></h1>
  <p>Browse live home improvement projects, read community Q&amp;A, and connect with top-rated contractors.</p>
  <div class="hero-btns">
    <a href="${esc(HANDYMAN_API)}/projects/post" class="btn-hero-p">Post a Project →</a>
    <a href="${esc(signupLink)}"                 class="btn-hero-s">Join Free</a>
  </div>
</section>
<svg viewBox="0 0 1440 40" xmlns="http://www.w3.org/2000/svg"
     style="display:block;background:var(--brand)">
  <path d="M0,40 C360,0 1080,0 1440,40 L1440,0 L0,0 Z" fill="${brandColor}"/>
</svg>

<!-- Tab bar -->
<div class="tabs-bar">
  <div class="tabs-inner">
    <div class="tab active" id="tab-projects"    onclick="switchTab('projects')"   >🏗️ Recent Projects</div>
    <div class="tab"        id="tab-discussions" onclick="switchTab('discussions')" >💬 Discussions</div>
    <div class="tab"        id="tab-contractors" onclick="switchTab('contractors')" >🔍 Find Contractors</div>
    <a href="/contribute" class="tab" style="text-decoration:none">🤝 Contribute</a>
  </div>
</div>

<!-- Main content -->
<div class="content">

  <!-- Left: tab panels -->
  <div>

    <!-- Panel: Projects -->
    <div id="panel-projects" class="tab-panel">
      <div style="margin-bottom:28px">
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:.72rem;font-weight:600;color:var(--orange);
                        text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Latest Activity</div>
            <div style="font-size:1.3rem;font-weight:800">Recent Projects</div>
          </div>
          <a href="${esc(HANDYMAN_API)}/projects/post"
             style="background:var(--orange);color:#fff;padding:9px 20px;
                    border-radius:8px;font-size:.85rem;font-weight:600">+ Post Project</a>
        </div>
        <div class="projects-list">${projectCards}</div>
      </div>
    </div>

    <!-- Panel: Discussions -->
    <div id="panel-discussions" class="tab-panel" style="display:none">
      <div>
        <div style="display:flex;align-items:center;justify-content:space-between;
                    margin-bottom:16px;flex-wrap:wrap;gap:10px">
          <div>
            <div style="font-size:.72rem;font-weight:600;color:var(--orange);
                        text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Community Q&amp;A</div>
            <div style="font-size:1.3rem;font-weight:800">Latest Discussions</div>
          </div>
          <a href="${esc(HANDYMAN_API)}/questions"
             style="background:var(--brand);color:#fff;padding:9px 20px;
                    border-radius:8px;font-size:.85rem;font-weight:600">View All →</a>
        </div>
        <div class="questions-list">${questionCards}</div>
        <div style="margin-top:18px;text-align:center">
          <a href="${esc(HANDYMAN_API)}/questions/ask"
             style="display:inline-block;background:var(--orange);color:#fff;padding:12px 28px;
                    border-radius:9px;font-weight:700;font-size:.9rem">+ Ask a Question →</a>
        </div>
      </div>
    </div>

    <!-- Panel: Find Contractors -->
    <div id="panel-contractors" class="tab-panel" style="display:none">
      <div>
        <div style="font-size:.72rem;font-weight:600;color:var(--orange);
                    text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">Browse Pros</div>
        <div style="font-size:1.3rem;font-weight:800;margin-bottom:20px">Find Contractors Near You</div>

        <!-- Search bar -->
        <div style="display:flex;gap:10px;margin-bottom:24px;flex-wrap:wrap">
          <input id="ctr-search" type="text" placeholder="Plumber, electrician, roofer…"
            style="flex:1;min-width:200px;padding:12px 16px;border:1.5px solid var(--border);
                   border-radius:9px;font-size:.9rem;outline:none;font-family:inherit"
            onfocus="this.style.borderColor='var(--brand)'"
            onblur="this.style.borderColor='var(--border)'">
          <input id="ctr-zip" type="text" placeholder="ZIP code" maxlength="10"
            style="width:130px;padding:12px 16px;border:1.5px solid var(--border);
                   border-radius:9px;font-size:.9rem;outline:none;font-family:inherit"
            onfocus="this.style.borderColor='var(--brand)'"
            onblur="this.style.borderColor='var(--border)'">
          <button onclick="searchContractors()"
            style="background:var(--brand);color:#fff;padding:12px 24px;border-radius:9px;
                   font-weight:700;font-size:.9rem;border:none;cursor:pointer;white-space:nowrap">
            Search →
          </button>
        </div>

        <!-- Paid contractor cards (loaded at render time) -->
        ${(() => {
          if (!contractors || contractors.length === 0) return "";
          const cCards = contractors.map(c => {
            const name     = esc(c.name ?? c.business_name ?? c.full_name ?? "Pro Contractor");
            const city     = esc([c.city, c.state].filter(Boolean).join(", "));
            const about    = esc((c.about ?? c.bio ?? c.description ?? "").slice(0, 80));
            const rate     = c.rate ? `<span style="font-weight:700;color:var(--brand)">$${esc(String(c.rate))}/hr</span>` : "";
            const rating   = c.rating ? `<span>⭐ ${esc(String(c.rating))}</span>` : "";
            const slug     = c.slug ?? c.contractor_id ?? c.id ?? "";
            const profUrl  = slug ? `${HANDYMAN_API}/s/${esc(String(slug))}?ref=${refSlug}` : `${HANDYMAN_API}/contractors?ref=${refSlug}`;
            const avatar   = c.photo_url
              ? `<img src="${esc(c.photo_url)}" alt="${name}"
                      style="width:46px;height:46px;border-radius:50%;object-fit:cover;flex-shrink:0">`
              : `<div style="width:46px;height:46px;border-radius:50%;background:var(--brand);
                             display:flex;align-items:center;justify-content:center;
                             color:#fff;font-weight:800;font-size:1.1rem;flex-shrink:0">
                   ${name.charAt(0)}
                 </div>`;
            return `
            <a href="${profUrl}" class="ctr-card" target="_blank" rel="noopener">
              <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
                ${avatar}
                <div>
                  <div style="font-weight:700;font-size:.92rem">${name}</div>
                  ${city ? `<div style="font-size:.75rem;color:var(--muted)">📍 ${city}</div>` : ""}
                </div>
                <div style="margin-left:auto;text-align:right">
                  ${rate}
                  <div style="font-size:.7rem;background:#dcfce7;color:#166534;
                               padding:2px 7px;border-radius:100px;font-weight:600;margin-top:2px">✓ Paid Pro</div>
                </div>
              </div>
              ${about ? `<div style="font-size:.78rem;color:var(--muted);line-height:1.4;margin-bottom:8px">${about}${(c.about ?? c.bio ?? c.description ?? "").length > 80 ? "…" : ""}</div>` : ""}
              <div style="display:flex;justify-content:space-between;align-items:center">
                <div style="display:flex;gap:8px;font-size:.75rem;color:var(--muted)">${rating}</div>
                <span style="font-size:.78rem;color:var(--brand);font-weight:600">View Profile →</span>
              </div>
            </a>`;
          }).join("");
          return `
        <div style="font-size:.8rem;font-weight:600;color:var(--muted);
                    text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">⭐ Featured Paid Pros</div>
        <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:28px">${cCards}</div>
        <div style="text-align:right;margin-bottom:24px">
          <a href="${HANDYMAN_API}/contractors?ref=${refSlug}"
             style="font-size:.82rem;color:var(--brand);font-weight:600">View All Contractors →</a>
        </div>`;
        })()}

        <!-- Service category grid -->
        <div style="font-size:.8rem;font-weight:600;color:var(--muted);
                    text-transform:uppercase;letter-spacing:.06em;margin-bottom:12px">Browse by Category</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:28px">
          ${[
            { icon: "🔧", name: "Plumbing" },
            { icon: "⚡", name: "Electrical" },
            { icon: "🏠", name: "Roofing" },
            { icon: "🎨", name: "Painting" },
            { icon: "❄️", name: "HVAC" },
            { icon: "🌿", name: "Landscaping" },
            { icon: "🚿", name: "Bathrooms" },
            { icon: "🪟", name: "Windows" },
            { icon: "🔑", name: "Locksmith" },
            { icon: "🧹", name: "Cleaning" },
            { icon: "🔩", name: "Carpentry" },
            { icon: "🏊", name: "Pools" },
          ].map(s => `
            <a href="${esc(HANDYMAN_API)}/contractors/${s.name.toLowerCase()}?ref=${refSlug}"
               style="background:#fff;border:1.5px solid var(--border);border-radius:10px;
                      padding:14px 12px;text-align:center;transition:all .2s;display:block"
               onmouseover="this.style.borderColor='var(--brand)';this.style.background='#fff8f8'"
               onmouseout="this.style.borderColor='var(--border)';this.style.background='#fff'">
              <div style="font-size:1.5rem;margin-bottom:5px">${s.icon}</div>
              <div style="font-size:.8rem;font-weight:600;color:var(--text)">${s.name}</div>
            </a>`).join("")}
        </div>

        <div style="background:linear-gradient(135deg,var(--brand),#3a0000);border-radius:14px;
                    padding:28px;text-align:center;color:#fff">
          <h3 style="font-size:1.2rem;font-weight:800;margin-bottom:8px">Are You a Contractor?</h3>
          <p style="opacity:.85;font-size:.88rem;margin-bottom:18px">
            Join 5,000+ pros on Handyman.com. Get leads, build your reputation, and grow your business.
          </p>
          <a href="${esc(signupLink)}"
             style="display:inline-block;background:var(--orange);color:#fff;padding:12px 28px;
                    border-radius:9px;font-weight:700;font-size:.9rem">Join Free →</a>
        </div>
      </div>
    </div>

  </div>

  <!-- Right: sidebar -->
  <div class="sidebar">
    <div class="cta-sidebar">
      <h3>Are You a Contractor?</h3>
      <p>Join our network, get featured, and receive quality project leads in your area.</p>
      <a href="${esc(signupLink)}" class="btn-sidebar">Join Free →</a>
    </div>

    <div class="sidebar-card">
      <div class="sidebar-title">Quick Actions</div>
      <a href="${esc(HANDYMAN_API)}/projects/post" class="post-btn" style="margin-bottom:10px">📋 Post a Project</a>
      <a href="${esc(HANDYMAN_API)}/questions"     class="ask-btn">💬 Ask a Question</a>
    </div>

    <div class="sidebar-card">
      <div class="sidebar-title">Platform Stats</div>
      <div class="stat-row"><span class="stat-row-lbl">Active Contractors</span><span class="stat-row-val">5,000+</span></div>
      <div class="stat-row"><span class="stat-row-lbl">Projects Posted</span><span class="stat-row-val">12,000+</span></div>
      <div class="stat-row"><span class="stat-row-lbl">Q&amp;A Answered</span><span class="stat-row-val">8,500+</span></div>
      <div class="stat-row"><span class="stat-row-lbl">Avg Rating</span><span class="stat-row-val">4.8 ★</span></div>
    </div>

    <div class="sidebar-card">
      <div class="sidebar-title">Browse Services</div>
      <div style="display:flex;flex-wrap:wrap">${serviceTags}</div>
    </div>

    <!-- Handyman.com mini card in sidebar -->
    <div class="sidebar-card" style="background:linear-gradient(135deg,#fff8f0,#fff);border-color:#fde8cc">
      <div class="sidebar-title" style="color:var(--orange)">🏠 Handyman.com</div>
      <p style="font-size:.8rem;color:var(--muted);margin-bottom:12px;line-height:1.5">
        The #1 platform connecting homeowners with trusted local handymen &amp; contractors.
      </p>
      <a href="${esc(HANDYMAN_API)}" target="_blank" rel="noopener"
         style="display:block;background:var(--brand);color:#fff;padding:10px;
                border-radius:8px;font-weight:700;font-size:.82rem;text-align:center">
        Visit Handyman.com →
      </a>
    </div>
  </div>

</div>

<!-- Refer section -->
<div class="refer-section">
  <div class="refer-inner">
    <div class="refer-text">
      <h2>🤝 Partner With Handyman.com</h2>
      <p>Own a site in the home improvement space? Become a partner, send referrals,
         and earn commission on every paid contractor signup.</p>
    </div>
    <div class="refer-action">
      <a href="${esc(HANDYMAN_API)}/partners" class="btn-refer">Apply as Partner</a>
      <a href="${esc(referLink)}"
         style="text-align:center;font-size:.82rem;color:var(--muted)">Or get your referral link →</a>
    </div>
  </div>
</div>

<!-- Handyman.com Feature Section -->
${handymanSectionHtml}

<!-- Partner Domains Section -->
${partnerSectionHtml}

<!-- Related Domains Section -->
${relatedSectionHtml}

<!-- Newsletter Modal -->
<div class="nl-overlay" id="nlOverlay" role="dialog" aria-modal="true" aria-labelledby="nlTitle">
  <div class="nl-box">
    <div class="nl-top">
      <button class="nl-close" onclick="nlClose()" aria-label="Close">✕</button>
      <div class="nl-icon">🔨</div>
      <h2 id="nlTitle">Get Home Improvement Tips</h2>
      <p>Join thousands of homeowners getting free contractor tips, project ideas, and community Q&amp;A delivered weekly.</p>
    </div>
    <div class="nl-body">
      <input class="nl-input" id="nlName"  type="text"  placeholder="Your first name (optional)" autocomplete="given-name">
      <input class="nl-input" id="nlEmail" type="email" placeholder="Your email address *" autocomplete="email" required>
      <button class="nl-submit" onclick="nlSubmit()">Subscribe Free →</button>
      <div class="nl-msg" id="nlMsg"></div>
      <span class="nl-skip" onclick="nlClose()">No thanks, maybe later</span>
    </div>
  </div>
</div>

<!-- Footer -->
<footer>
  <div class="footer-links">
    <a href="${esc(HANDYMAN_API)}" target="_blank">Handyman.com</a>
    <a href="${esc(HANDYMAN_API)}/contractors" target="_blank">Find Contractors</a>
    <a href="${esc(HANDYMAN_API)}/projects/post" target="_blank">Post a Project</a>
    <a href="${esc(HANDYMAN_API)}/questions" target="_blank">Community</a>
    <a href="${esc(HANDYMAN_API)}/partners" target="_blank">Partner Program</a>
    <a href="${esc(HANDYMAN_API)}/privacy" target="_blank">Privacy</a>
    <a href="${esc(HANDYMAN_API)}/terms" target="_blank">Terms</a>
  </div>
  <p>© ${year} Handyman.com Partner Network · Powered by <a href="https://vnoc.com" target="_blank">VNOC</a></p>
</footer>

<script>
// Tab switching — global function, called directly via onclick attributes
function switchTab(name) {
  // Update tab highlights
  ['projects','discussions','contractors'].forEach(function(t) {
    var el = document.getElementById('tab-' + t);
    if (el) el.classList.toggle('active', t === name);
  });
  // Show/hide panels
  ['projects','discussions','contractors'].forEach(function(t) {
    var p = document.getElementById('panel-' + t);
    if (p) p.style.display = (t === name) ? 'block' : 'none';
  });
  // Smooth scroll to content
  var content = document.querySelector('.content');
  if (content) content.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Contractor search
function searchContractors() {
  var q   = (document.getElementById('ctr-search').value || '').trim();
  var zip = (document.getElementById('ctr-zip').value || '').trim();
  var url = '${HANDYMAN_API}/contractors';
  var params = [];
  if (q)   params.push('q='   + encodeURIComponent(q));
  if (zip) params.push('zip=' + encodeURIComponent(zip));
  params.push('ref=${refSlug}');
  if (params.length) url += '?' + params.join('&');
  window.open(url, '_blank');
}

// Allow Enter key in search inputs
['ctr-search','ctr-zip'].forEach(function(id) {
  var el = document.getElementById(id);
  if (el) el.addEventListener('keydown', function(e){ if (e.key === 'Enter') searchContractors(); });
});

// ── Newsletter Modal ──────────────────────────────────────────────────────────
(function() {
  var STORAGE_KEY = 'nl_dismissed_${hostname}';
  // Don't show if already dismissed/subscribed this session or in last 7 days
  try {
    var ts = localStorage.getItem(STORAGE_KEY);
    if (ts && (Date.now() - parseInt(ts, 10)) < 7 * 24 * 60 * 60 * 1000) return;
  } catch(e) {}

  // Show after 6 seconds or after scrolling 40% of the page
  var shown = false;
  function showModal() {
    if (shown) return;
    shown = true;
    var overlay = document.getElementById('nlOverlay');
    if (overlay) {
      overlay.style.display = 'flex';
      requestAnimationFrame(function(){ overlay.classList.add('show'); });
      document.getElementById('nlEmail').focus();
    }
  }

  var timer = setTimeout(showModal, 6000);

  window.addEventListener('scroll', function onScroll() {
    var scrolled = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
    if (scrolled >= 40) { clearTimeout(timer); showModal(); window.removeEventListener('scroll', onScroll); }
  }, { passive: true });

  // Close on overlay click (outside box)
  var overlay = document.getElementById('nlOverlay');
  if (overlay) {
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) nlClose();
    });
  }

  // Close on Escape
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') nlClose(); });
})();

function nlClose() {
  var overlay = document.getElementById('nlOverlay');
  if (!overlay) return;
  overlay.classList.remove('show');
  setTimeout(function(){ overlay.style.display = 'none'; }, 300);
  try { localStorage.setItem('nl_dismissed_${hostname}', String(Date.now())); } catch(e) {}
}

function nlSubmit() {
  var email = (document.getElementById('nlEmail').value || '').trim();
  var name  = (document.getElementById('nlName').value  || '').trim();
  var msg   = document.getElementById('nlMsg');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    msg.className = 'nl-msg err'; msg.style.display = 'block';
    msg.textContent = 'Please enter a valid email address.'; return;
  }

  var btn = document.querySelector('.nl-submit');
  btn.disabled = true; btn.textContent = 'Subscribing…';
  msg.style.display = 'none';

  var fd = new FormData();
  fd.append('type',   'lead');
  fd.append('domain', '${hostname}');
  fd.append('email',  email);
  fd.append('name',   name);
  fd.append('message','Newsletter signup from ${hostname}');

  fetch('https://manage.vnoc.com/ajax/lander_submit.php', { method: 'POST', body: fd })
    .then(function(r) { return r.json(); })
    .then(function(j) {
      if (j.success) {
        msg.className = 'nl-msg ok'; msg.style.display = 'block';
        msg.textContent = '🎉 You are subscribed! Check your inbox soon.';
        btn.style.display = 'none';
        document.querySelector('.nl-skip').style.display = 'none';
        try { localStorage.setItem('nl_dismissed_${hostname}', String(Date.now())); } catch(e) {}
        setTimeout(nlClose, 3000);
      } else {
        msg.className = 'nl-msg err'; msg.style.display = 'block';
        msg.textContent = j.msg || 'Something went wrong. Please try again.';
        btn.disabled = false; btn.textContent = 'Subscribe Free →';
      }
    })
    .catch(function() {
      msg.className = 'nl-msg err'; msg.style.display = 'block';
      msg.textContent = 'Network error. Please try again.';
      btn.disabled = false; btn.textContent = 'Subscribe Free →';
    });
}
</script>

</body>
</html>`;
}
