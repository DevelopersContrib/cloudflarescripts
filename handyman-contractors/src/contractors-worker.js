/**
 * handyman-contractors — Cloudflare Worker
 * Multi-domain contractor lander for the Handyman Partner Network.
 * Deployed directly via wrangler (no cfbuilder templating needed).
 *
 * Env vars (wrangler.contractors.toml [vars] + secrets):
 *   HANDYMAN_API_URL   — https://www.handyman.com
 *   WORKER_API_KEY     — shared secret for register-domain endpoint
 *   VNOC_API_URL       — https://manage.vnoc.com  (optional)
 *
 * KV binding: CACHE
 */

const BRAND_COLOR = "#670708";
const ACCENT_COLOR = "#FF9000";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const hostname = url.hostname.replace(/^www\./, "");
    const HANDYMAN = (env.HANDYMAN_API_URL ?? "https://www.handyman.com").replace(/\/$/, "");

    if (url.pathname === "/robots.txt") {
      return txt(`User-agent: *\nAllow: /\nSitemap: https://${hostname}/sitemap.xml`);
    }
    if (url.pathname === "/sitemap.xml") {
      return xml(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${hostname}/</loc><changefreq>daily</changefreq></url></urlset>`);
    }
    if (url.pathname === "/.well-known/agent.json") {
      return json({ name: titleFromHostname(hostname), domain: hostname, vertical: "Handyman", hub: HANDYMAN, network: "Handyman Partner Network" });
    }

    // Parallel: affiliate reg + contractors + domain info
    const [refId, contractors, domainInfo] = await Promise.all([
      getOrRegisterAffiliate(hostname, env, HANDYMAN),
      fetchContractors(env, HANDYMAN),
      fetchDomainInfo(hostname, env),
    ]);

    const signupLink = refId ? `${HANDYMAN}/signup?ref=${refId}&refType=contractor` : `${HANDYMAN}/signup`;
    const referLink = `${HANDYMAN}/refer/${hostname.replace(/\./g, "-")}`;
    const pageTitle = domainInfo.title || titleFromHostname(hostname);
    const logoHtml = domainInfo.logo ? `<img src="${esc(domainInfo.logo)}" alt="${esc(pageTitle)}" style="max-height:34px">` : `<div class="icon">🔧</div>`;

    return html(renderPage({ hostname, signupLink, referLink, contractors, siblings: domainInfo.siblings ?? [], pageTitle, logoHtml, HANDYMAN }));
  },
};

// ── Domain info from VNOC API ─────────────────────────────────────────────

async function fetchDomainInfo(hostname, env) {
  const cacheKey = `vnoc:domain:${hostname}`;
  if (env.CACHE) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) { try { return JSON.parse(cached); } catch {} }
  }
  const fallback = { title: titleFromHostname(hostname), logo: "", siblings: [] };
  try {
    const vnoc = (env.VNOC_API_URL ?? "https://manage.vnoc.com").replace(/\/$/, "");
    const res = await fetch(`${vnoc}/v2/domainsite/workerinfo?domain=${encodeURIComponent(hostname)}&key=${env.VNOC_API_KEY ?? ""}`, { cf: { cacheTtl: 3600 } });
    if (res.ok) {
      const data = await res.json();
      const info = { title: data.title || fallback.title, logo: data.logo || "", siblings: data.related ?? data.siblings ?? [] };
      if (env.CACHE) await env.CACHE.put(cacheKey, JSON.stringify(info), { expirationTtl: 3600 });
      return info;
    }
  } catch (_) {}
  return fallback;
}

// ── Affiliate auto-registration ──────────────────────────────────────────

async function getOrRegisterAffiliate(hostname, env, HANDYMAN) {
  if (!env.CACHE) return null;
  const key = `affiliate:${hostname}`;
  const cached = await env.CACHE.get(key);
  if (cached) return parseInt(cached, 10);
  try {
    const res = await fetch(`${HANDYMAN}/api/affiliate/register-domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domain: hostname, apiKey: env.WORKER_API_KEY ?? "" }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ref_id) {
        await env.CACHE.put(key, String(data.ref_id), { expirationTtl: 86400 * 30 });
        return data.ref_id;
      }
    }
  } catch (_) {}
  return null;
}

// ── Contractors from public API ──────────────────────────────────────────

async function fetchContractors(env, HANDYMAN) {
  if (env.CACHE) {
    const cached = await env.CACHE.get("hm:contractors");
    if (cached) { try { return JSON.parse(cached); } catch {} }
  }
  try {
    const res = await fetch(`${HANDYMAN}/api/public/contractors?limit=6`);
    if (res.ok) {
      const data = await res.json();
      const list = data.contractors ?? [];
      if (env.CACHE) await env.CACHE.put("hm:contractors", JSON.stringify(list), { expirationTtl: 900 });
      return list;
    }
  } catch (_) {}
  return [];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function titleFromHostname(h) {
  return h.split(".")[0].replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function esc(s) { return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }
function html(body) { return new Response(body, { headers: { "Content-Type": "text/html;charset=UTF-8", "Cache-Control": "public, max-age=300" } }); }
function txt(body) { return new Response(body, { headers: { "Content-Type": "text/plain" } }); }
function xml(body) { return new Response(body, { headers: { "Content-Type": "application/xml" } }); }
function json(obj) { return Response.json(obj); }

function serviceIcons() {
  return [
    ["🔧","Plumbing"],["⚡","Electrical"],["🪟","Windows"],["🏠","Roofing"],
    ["🎨","Painting"],["❄️","HVAC"],["🚿","Bathrooms"],["🌿","Landscaping"],
  ].map(([icon, label]) => `<div class="svc-item"><span class="svc-icon">${icon}</span><span class="svc-lbl">${label}</span></div>`).join("");
}

function renderContractorCards(contractors, hostname, HANDYMAN) {
  if (!contractors.length) return `<div class="empty-card"><div style="font-size:3rem;margin-bottom:12px">🔨</div><h3>Be the First Featured Pro</h3><p>Join hundreds of contractors already growing with Handyman.com</p></div>`;
  const colors = ["#670708","#a83232","#c0392b","#922b21","#7b241c","#641e16"];
  return contractors.map((c, i) => {
    const bg = colors[i % colors.length];
    const profileUrl = `${HANDYMAN}/s/${encodeURIComponent(c.slug ?? c.ContractorId)}?ref=${hostname.replace(/\./g,"-")}`;
    const about = (c.AboutBusiness ?? "").slice(0, 110) + ((c.AboutBusiness?.length ?? 0) > 110 ? "…" : "");
    const initials = (c.Name ?? "?").split(" ").map(w => w[0]).slice(0,2).join("").toUpperCase();
    return `<div class="pro-card">
      <div class="pro-header" style="background:${bg}">
        <div class="pro-avatar">${initials}</div>
        <div class="pro-header-info">
          <div class="pro-name">${esc(c.Name ?? "Contractor")}</div>
          <div class="pro-location">📍 ${esc(c.City ?? "")}, ${esc(c.State ?? "")}</div>
        </div>
      </div>
      <div class="pro-body">
        <div class="pro-badges">
          ${c.paidUpgrade ? `<span class="badge-verified">✓ Verified Pro</span>` : ""}
          ${c.rate ? `<span class="badge-rate">$${esc(c.rate)}/hr</span>` : ""}
        </div>
        <p class="pro-about">${esc(about)}</p>
        <a href="${profileUrl}" class="pro-btn" target="_blank">View Full Profile →</a>
      </div>
    </div>`;
  }).join("");
}

// ── Page renderer ────────────────────────────────────────────────────────

function renderPage({ hostname, signupLink, referLink, contractors, siblings, pageTitle, logoHtml, HANDYMAN }) {
  const year = new Date().getFullYear();
  const sibHtml = siblings.map(s => `<a href="https://${esc(s)}" class="tag" target="_blank">${esc(s)}</a>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(pageTitle)} — Trusted Handyman Contractors</title>
<meta name="description" content="Find trusted, verified handymen and contractors on ${esc(hostname)}. Powered by Handyman.com.">
<meta property="og:title" content="${esc(pageTitle)} — Find Trusted Handymen">
<meta property="og:type" content="website">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
:root{--brand:${BRAND_COLOR};--orange:${ACCENT_COLOR};--bg:#f5f4f2;--card:#fff;--text:#1a1a1a;--muted:#6b7280;--border:#e5e7eb;--r:14px;--sh:0 4px 24px rgba(0,0,0,.08);--sh2:0 8px 40px rgba(0,0,0,.14)}
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:'Inter',system-ui,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
a{text-decoration:none;color:inherit}

.navbar{position:sticky;top:0;z-index:100;background:rgba(103,7,8,.97);backdrop-filter:blur(12px);border-bottom:1px solid rgba(255,255,255,.08);padding:0 24px;height:64px;display:flex;align-items:center;justify-content:space-between}
.nb{display:flex;align-items:center;gap:10px;color:#fff;font-size:1.1rem;font-weight:700}
.icon{width:34px;height:34px;background:var(--orange);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:1.1rem}
.na{display:flex;gap:10px;align-items:center}
.nl{color:rgba(255,255,255,.75);font-size:.88rem;font-weight:500;padding:7px 14px;border-radius:7px;transition:.2s}.nl:hover{color:#fff;background:rgba(255,255,255,.1)}
.nb2{background:var(--orange);color:#fff;padding:9px 22px;border-radius:8px;font-weight:600;font-size:.88rem;white-space:nowrap;transition:.2s}.nb2:hover{background:#e07800}

.hero{position:relative;background:var(--brand);overflow:hidden;padding:90px 24px 80px;text-align:center}
.hero::before{content:'';position:absolute;inset:0;background:url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='0.03'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/svg%3E")}
.hbadge{display:inline-flex;align-items:center;gap:6px;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);color:rgba(255,255,255,.9);padding:6px 16px;border-radius:100px;font-size:.8rem;font-weight:500;margin-bottom:20px}
.hero h1{font-size:clamp(2rem,5vw,3.4rem);font-weight:900;color:#fff;line-height:1.1;letter-spacing:-.02em;margin-bottom:16px;max-width:720px;margin-left:auto;margin-right:auto}
.hero h1 span{color:var(--orange)}
.hero p{color:rgba(255,255,255,.8);font-size:1.1rem;max-width:520px;margin:0 auto 32px}
.hbtns{display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:48px}
.btp{background:var(--orange);color:#fff;padding:15px 36px;border-radius:10px;font-weight:700;font-size:1rem;box-shadow:0 4px 20px rgba(255,144,0,.4);transition:.2s}.btp:hover{background:#e07800;transform:translateY(-1px)}
.bts{background:rgba(255,255,255,.12);color:#fff;padding:15px 36px;border-radius:10px;font-weight:600;font-size:1rem;border:1px solid rgba(255,255,255,.25);transition:.2s}.bts:hover{background:rgba(255,255,255,.2)}
.hstats{display:flex;justify-content:center;flex-wrap:wrap}
.hs{padding:16px 32px;border-right:1px solid rgba(255,255,255,.15)}.hs:last-child{border-right:none}
.hsn{font-size:1.8rem;font-weight:800;color:#fff}.hsl{font-size:.78rem;color:rgba(255,255,255,.6);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}

.wave{display:block;background:var(--brand);line-height:0}.wave svg{display:block}

.svcs{background:#fff;padding:32px 24px;border-bottom:1px solid var(--border)}
.svcg{max-width:900px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:12px}
.svc-item{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;border-radius:10px;border:1px solid transparent;transition:.2s;cursor:pointer}.svc-item:hover{background:#fff5f0;border-color:#ffd0a0}
.svc-icon{font-size:1.6rem}.svc-lbl{font-size:.75rem;font-weight:500;color:var(--muted);text-align:center}

.sec{max-width:1100px;margin:0 auto;padding:56px 24px}
.stag{display:inline-block;background:#fff3e0;color:var(--orange);font-size:.75rem;font-weight:600;padding:4px 12px;border-radius:100px;margin-bottom:10px;text-transform:uppercase;letter-spacing:.05em}
.sti{font-size:1.75rem;font-weight:800;line-height:1.2}.ssu{color:var(--muted);margin-top:6px;font-size:.95rem}

.pgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(310px,1fr));gap:20px}
.pro-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);overflow:hidden;transition:.25s;border:1px solid var(--border)}.pro-card:hover{transform:translateY(-4px);box-shadow:var(--sh2)}
.pro-header{padding:20px 20px 16px;display:flex;align-items:center;gap:14px}
.pro-avatar{width:52px;height:52px;min-width:52px;border-radius:50%;background:rgba(255,255,255,.25);color:#fff;font-size:1.1rem;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid rgba(255,255,255,.3)}
.pro-header-info{color:#fff}.pro-name{font-weight:700;font-size:1rem;line-height:1.2}.pro-location{font-size:.78rem;opacity:.8;margin-top:2px}
.pro-body{padding:16px 20px 20px}
.pro-badges{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap}
.badge-verified{background:#dcfce7;color:#166534;font-size:.72rem;font-weight:600;padding:3px 10px;border-radius:100px}
.badge-rate{background:#fff3e0;color:#c2410c;font-size:.72rem;font-weight:600;padding:3px 10px;border-radius:100px}
.pro-about{font-size:.85rem;color:var(--muted);line-height:1.5;margin-bottom:14px;min-height:52px}
.pro-btn{display:block;text-align:center;background:var(--brand);color:#fff;padding:10px 20px;border-radius:8px;font-size:.85rem;font-weight:600;transition:.2s}.pro-btn:hover{background:#4a0505;transform:translateY(-1px)}
.empty-card{background:var(--card);border-radius:var(--r);box-shadow:var(--sh);padding:48px 32px;text-align:center;grid-column:1/-1;border:2px dashed var(--border)}
.empty-card h3{font-size:1.1rem;font-weight:700;margin:8px 0;color:var(--text)}.empty-card p{color:var(--muted);font-size:.9rem}

.how{background:#fff;padding:56px 0}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:24px;max-width:1100px;margin:0 auto;padding:0 24px}
.step{text-align:center;padding:28px 20px}
.step-n{width:52px;height:52px;background:var(--brand);color:#fff;font-size:1.2rem;font-weight:800;border-radius:50%;display:flex;align-items:center;justify-content:center;margin:0 auto 16px}
.step h3{font-weight:700;font-size:1rem;margin-bottom:8px}.step p{font-size:.85rem;color:var(--muted);line-height:1.5}

.ctab{background:linear-gradient(135deg,var(--brand) 0%,#3a0000 100%);border-radius:var(--r);padding:52px 40px;text-align:center;color:#fff;position:relative;overflow:hidden;margin-top:40px}
.ctab::before{content:'🔧';position:absolute;right:-10px;top:-10px;font-size:8rem;opacity:.06}
.ctab h2{font-size:1.8rem;font-weight:800;margin-bottom:10px;line-height:1.2}
.ctab p{opacity:.85;max-width:460px;margin:0 auto 28px;font-size:.95rem}
.btc{display:inline-block;background:var(--orange);color:#fff;padding:14px 36px;border-radius:10px;font-weight:700;font-size:1rem;box-shadow:0 4px 20px rgba(255,144,0,.35);transition:.2s}.btc:hover{background:#e07800;transform:translateY(-1px)}

.refs{background:#fff;border-top:1px solid var(--border);border-bottom:1px solid var(--border)}
.refi{max-width:1100px;margin:0 auto;padding:52px 24px;display:flex;align-items:center;justify-content:space-between;gap:32px;flex-wrap:wrap}
.reft h2{font-size:1.5rem;font-weight:800;margin-bottom:8px}.reft p{color:var(--muted);max-width:440px;font-size:.95rem}
.refa{display:flex;flex-direction:column;gap:10px;min-width:220px}
.btr{background:var(--brand);color:#fff;padding:13px 28px;border-radius:9px;font-weight:700;font-size:.95rem;text-align:center;transition:.2s}.btr:hover{background:#4a0505}
.refn{font-size:.75rem;color:var(--muted);text-align:center}

.parts{background:var(--bg);padding:40px 24px}.parti{max-width:1100px;margin:0 auto}
.partt{font-size:.85rem;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin-bottom:16px}
.tags{display:flex;flex-wrap:wrap;gap:8px}
.tag{background:#fff;border:1px solid var(--border);color:var(--muted);padding:7px 16px;border-radius:100px;font-size:.8rem;font-weight:500;transition:.2s}.tag:hover{background:var(--brand);color:#fff;border-color:var(--brand)}

footer{background:#111;color:#6b7280;padding:32px 24px;text-align:center;font-size:.82rem}
footer a{color:var(--orange)}
.fl{display:flex;justify-content:center;gap:20px;margin-bottom:12px;flex-wrap:wrap}

@media(max-width:700px){.hero{padding:60px 18px 50px}.hs{padding:12px 18px}.na .nl{display:none}.refi{flex-direction:column;text-align:center}.ctab{padding:36px 22px}.steps{grid-template-columns:1fr 1fr}}
@media(max-width:440px){.steps{grid-template-columns:1fr}}
</style>
</head>
<body>

<nav class="navbar">
  <div class="nb">${logoHtml}<span>${esc(pageTitle)}</span></div>
  <div class="na">
    <a href="${HANDYMAN}/projects/post" class="nl">Post Project</a>
    <a href="${HANDYMAN}/contractors" class="nl">Find Pro</a>
    <a href="${signupLink}" class="nb2">Join as Contractor</a>
  </div>
</nav>

<section class="hero">
  <div class="hbadge">🔨 Trusted by 5,000+ Professionals</div>
  <h1>Find Trusted <span>Handymen</span><br>Near You</h1>
  <p>Connect with verified, paid contractors ready to tackle your next home or business project.</p>
  <div class="hbtns">
    <a href="${signupLink}" class="btp">Join as Contractor →</a>
    <a href="${HANDYMAN}/projects/post" class="bts">Post a Project</a>
  </div>
  <div class="hstats">
    <div class="hs"><div class="hsn">5,000+</div><div class="hsl">Verified Pros</div></div>
    <div class="hs"><div class="hsn">12K+</div><div class="hsl">Projects Done</div></div>
    <div class="hs"><div class="hsn">4.8★</div><div class="hsl">Avg Rating</div></div>
    <div class="hs"><div class="hsn">Free</div><div class="hsl">To Post</div></div>
  </div>
</section>
<div class="wave"><svg viewBox="0 0 1440 48" xmlns="http://www.w3.org/2000/svg"><path d="M0,48 C360,0 1080,0 1440,48 L1440,0 L0,0 Z" fill="${BRAND_COLOR}"/></svg></div>

<div class="svcs"><div class="svcg">${serviceIcons()}</div></div>

<div class="sec">
  <div style="margin-bottom:32px">
    <div class="stag">Featured Professionals</div>
    <div class="sti">Meet Our Top Contractors</div>
    <div class="ssu">Premium verified pros with proven track records — ready for your next project.</div>
  </div>
  <div class="pgrid">${renderContractorCards(contractors, hostname, HANDYMAN)}</div>
  <div class="ctab">
    <h2>Are You a Handyman or Contractor?</h2>
    <p>Join our network of paid professionals. Get featured, receive quality project leads, and grow your business.</p>
    <a href="${signupLink}" class="btc">Start Free Today →</a>
  </div>
</div>

<div class="how">
  <div style="max-width:1100px;margin:0 auto;padding:0 24px 32px;text-align:center">
    <div class="stag">Simple Process</div>
    <div class="sti">How Handyman.com Works</div>
  </div>
  <div class="steps">
    <div class="step"><div class="step-n">1</div><h3>Post Your Project</h3><p>Describe what you need in minutes. It's completely free to post.</p></div>
    <div class="step"><div class="step-n">2</div><h3>Get Free Quotes</h3><p>Up to 5 verified contractors will respond with competitive quotes.</p></div>
    <div class="step"><div class="step-n">3</div><h3>Choose Your Pro</h3><p>Compare profiles, reviews, and rates. Pick the best fit.</p></div>
    <div class="step"><div class="step-n">4</div><h3>Get It Done</h3><p>Your contractor handles the job. Leave a review when complete.</p></div>
  </div>
</div>

<div class="refs">
  <div class="refi">
    <div class="reft">
      <h2>Refer Contractors, Earn Commissions</h2>
      <p>Know a great handyman? Refer them via your personal link and earn every time they upgrade to a paid plan.</p>
    </div>
    <div class="refa">
      <a href="${referLink}" class="btr">Get My Referral Link</a>
      <span class="refn">Free to join · Earn per paid signup</span>
    </div>
  </div>
</div>

${sibHtml ? `<div class="parts"><div class="parti"><div class="partt">Partner &amp; Related Sites</div><div class="tags">${sibHtml}</div></div></div>` : ""}

<footer>
  <div class="fl">
    <a href="${HANDYMAN}">Handyman.com</a>
    <a href="${HANDYMAN}/contractors">Find Contractors</a>
    <a href="${HANDYMAN}/projects/post">Post a Project</a>
    <a href="${HANDYMAN}/partners">Partner Program</a>
    <a href="${HANDYMAN}/privacy">Privacy</a>
    <a href="${HANDYMAN}/terms">Terms</a>
  </div>
  <p>© ${year} Handyman.com Partner Network · Powered by <a href="https://vnoc.com">VNOC</a></p>
</footer>
</body></html>`;
}
