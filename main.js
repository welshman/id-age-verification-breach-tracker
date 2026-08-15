// Global ID & Age Verification Breach Tracker — main.js (v2)
const DATA_PATHS = { breaches: 'data/breaches.json', companies: 'data/companies.json', sources: 'data/sources.json' };
const _cache = {};

async function loadData(key) {
  if (_cache[key]) return _cache[key];
  const res = await fetch(DATA_PATHS[key], { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load ' + key);
  const json = await res.json();
  _cache[key] = json;
  return json;
}

function escapeHtml(str) {
  if (str === undefined || str === null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDate(iso) {
  try {
    const d = new Date(iso + 'T00:00:00Z');
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
  } catch (e) { return iso; }
}

function titleCase(str) { return String(str).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

function severityBadge(sev) {
  const cls = { low: 'badge-low', medium: 'badge-medium', high: 'badge-high', critical: 'badge-critical' }[sev] || 'badge-medium';
  return `<span class="badge ${cls}">${escapeHtml(titleCase(sev))}</span>`;
}

function companyNameById(companies, id) {
  const c = companies.find(c => c.id === id);
  return c ? c.name : id;
}

async function initHomepage() {
  const statsEl = document.getElementById('home-stats');
  const timelineEl = document.getElementById('home-timeline');
  if (!statsEl && !timelineEl) return;
  try {
    const [{ breaches }, { companies }] = await Promise.all([loadData('breaches'), loadData('companies')]);
    if (statsEl) {
      const totalBreaches = breaches.length;
      const totalCompanies = companies.length;
      const mostRecent = breaches.reduce((latest, b) => (!latest || b.date > latest.date ? b : latest), null);
      statsEl.innerHTML = `
        <div class="stat-card"><span class="stat-value">${totalBreaches}</span><span class="stat-label">Tracked breaches</span></div>
        <div class="stat-card"><span class="stat-value">${totalCompanies}</span><span class="stat-label">Monitored companies &amp; services</span></div>
        <div class="stat-card"><span class="stat-value">${mostRecent ? formatDate(mostRecent.date) : '—'}</span><span class="stat-label">Most recent known breach</span></div>
      `;
    }
    if (timelineEl) {
      const sorted = [...breaches].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6);
      timelineEl.innerHTML = sorted.map(b => `
        <div class="timeline-item">
          <div class="timeline-date">${formatDate(b.date)}</div>
          <div class="timeline-title"><a href="breaches.html#${escapeHtml(b.id)}">${escapeHtml(b.title)}</a> ${severityBadge(b.severity)}</div>
          <p>${escapeHtml(b.summary)}</p>
        </div>
      `).join('');
    }
  } catch (err) {
    if (statsEl) statsEl.innerHTML = `<p class="empty-state">Data is currently unavailable. Please try again later.</p>`;
    console.error(err);
  }
}

let _allBreaches = [];
let _allCompanies = [];

function sortBreaches(list, sortKey) {
  const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
  const copy = list.slice();
  copy.sort((a, b) => {
    if (sortKey === 'date-asc') return a.date < b.date ? -1 : (a.date > b.date ? 1 : 0);
    if (sortKey === 'severity-desc') return severityRank[b.severity] - severityRank[a.severity];
    if (sortKey === 'title-asc') return a.title.localeCompare(b.title);
    return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0);
  });
  return copy;
}

async function initBreachesPage() {
  const listEl = document.getElementById('breach-list');
  if (!listEl) return;
  const [{ breaches }, { companies }] = await Promise.all([loadData('breaches'), loadData('companies')]);
  _allBreaches = breaches; _allCompanies = companies;
  populateFilterOptions(breaches, companies);

  const sortSelect = document.getElementById('filter-sort');
  if (sortSelect && !sortSelect.value) sortSelect.value = 'date-desc';

  document.getElementById('filter-region').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-severity').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-company').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-datatype').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-sort').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-search').addEventListener('input', applyBreachFilters);

  applyBreachFilters();

  if (location.hash) {
    const target = document.querySelector(location.hash);
    if (target) {
      const details = target.querySelector('details');
      if (details) details.open = true;
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
}

function populateFilterOptions(breaches, companies) {
  const regionSel = document.getElementById('filter-region');
  const companySel = document.getElementById('filter-company');
  const dataTypeSel = document.getElementById('filter-datatype');
  const regions = [...new Set(breaches.flatMap(b => b.affected_regions))].sort();
  regions.forEach(r => regionSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(r)}">${escapeHtml(titleCase(r))}</option>`));
  const companiesInBreaches = [...new Set(breaches.flatMap(b => b.companies))].sort();
  companiesInBreaches.forEach(cid => companySel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(cid)}">${escapeHtml(companyNameById(companies, cid))}</option>`));
  const dataTypes = [...new Set(breaches.flatMap(b => b.data_types))].sort();
  dataTypes.forEach(dt => dataTypeSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(dt)}">${escapeHtml(titleCase(dt))}</option>`));
}

function applyBreachFilters() {
  const region = document.getElementById('filter-region').value;
  const severity = document.getElementById('filter-severity').value;
  const company = document.getElementById('filter-company').value;
  const dataType = document.getElementById('filter-datatype').value;
  const sort = document.getElementById('filter-sort').value || 'date-desc';
  const search = document.getElementById('filter-search').value.trim().toLowerCase();

  let filtered = _allBreaches.filter(b => {
    if (region && !b.affected_regions.includes(region)) return false;
    if (severity && b.severity !== severity) return false;
    if (company && !b.companies.includes(company)) return false;
    if (dataType && !b.data_types.includes(dataType)) return false;
    if (search) {
      const haystack = (b.title + ' ' + b.summary + ' ' + b.details).toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  filtered = sortBreaches(filtered, sort);
  renderBreachList(filtered, _allCompanies);
}

function renderBreachList(breaches, companies) {
  const listEl = document.getElementById('breach-list');
  const countEl = document.getElementById('breach-count');
  if (countEl) countEl.textContent = `${breaches.length} breach${breaches.length === 1 ? '' : 'es'}`;
  if (breaches.length === 0) {
    listEl.innerHTML = `<p class="empty-state">No breaches match your filters. Try broadening your search.</p>`;
    return;
  }
  listEl.innerHTML = breaches.map(b => {
    const companyLinks = b.companies.map(cid => {
      const c = companies.find(c => c.id === cid);
      return c ? `<a href="companies.html#${escapeHtml(c.id)}">${escapeHtml(c.name)}</a>` : escapeHtml(cid);
    }).join(', ');
    const dataTypeItems = b.data_types.map(dt => `<li>${escapeHtml(titleCase(dt))}</li>`).join('');
    const regionBadges = b.affected_regions.map(r => `<span class="badge badge-region">${escapeHtml(titleCase(r))}</span>`).join(' ');
    const sourceLinks = b.sources.map(s => `<li><a href="${escapeHtml(s)}" target="_blank" rel="noopener noreferrer">${escapeHtml(new URL(s).hostname.replace('www.', ''))}</a></li>`).join('');
    return `
      <article class="breach-card" id="${escapeHtml(b.id)}">
        <div class="breach-card-top"><h3>${escapeHtml(b.title)}</h3>${severityBadge(b.severity)}</div>
        <div class="breach-meta"><span class="badge badge-type">${escapeHtml(titleCase(b.verification_type))}</span>${regionBadges}<span class="timeline-date">${formatDate(b.date)}</span></div>
        <p class="summary">${escapeHtml(b.summary)}</p>
        <p><strong>Companies involved:</strong> ${companyLinks || 'Unspecified'}</p>
        <ul class="data-types-list">${dataTypeItems}</ul>
        <details><summary>Full details &amp; sources</summary><p>${escapeHtml(b.details)}</p><p><strong>Sources:</strong></p><ul class="source-list">${sourceLinks}</ul></details>
      </article>
    `;
  }).join('');
}

async function initCompaniesPage() {
  const listEl = document.getElementById('company-list');
  if (!listEl) return;
  const [{ companies }, { breaches }] = await Promise.all([loadData('companies'), loadData('breaches')]);
  _allCompanies = companies; _allBreaches = breaches;
  const regionSel = document.getElementById('filter-company-region');
  const typeSel = document.getElementById('filter-company-type');
  [...new Set(companies.map(c => c.region))].sort().forEach(r => regionSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(r)}">${escapeHtml(titleCase(r))}</option>`));
  [...new Set(companies.map(c => c.type))].sort().forEach(t => typeSel.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(t)}">${escapeHtml(titleCase(t))}</option>`));
  renderCompanyList(companies, breaches);
  regionSel.addEventListener('change', () => applyCompanyFilters());
  typeSel.addEventListener('change', () => applyCompanyFilters());
  document.getElementById('filter-company-search').addEventListener('input', () => applyCompanyFilters());
}

function applyCompanyFilters() {
  const region = document.getElementById('filter-company-region').value;
  const type = document.getElementById('filter-company-type').value;
  const search = document.getElementById('filter-company-search').value.trim().toLowerCase();
  const filtered = _allCompanies.filter(c => {
    if (region && c.region !== region) return false;
    if (type && c.type !== type) return false;
    if (search && !(c.name + ' ' + c.description).toLowerCase().includes(search)) return false;
    return true;
  });
  renderCompanyList(filtered, _allBreaches);
}

function renderCompanyList(companies, breaches) {
  const listEl = document.getElementById('company-list');
  const countEl = document.getElementById('company-count');
  if (countEl) countEl.textContent = `${companies.length} compan${companies.length === 1 ? 'y' : 'ies'}`;
  if (companies.length === 0) {
    listEl.innerHTML = `<p class="empty-state">No companies match your filters.</p>`;
    return;
  }
  listEl.innerHTML = companies.map(c => {
    const relatedBreaches = breaches.filter(b => b.companies.includes(c.id));
    const breachLinksHtml = relatedBreaches.map(b => `<li><a href="breaches.html#${escapeHtml(b.id)}">${escapeHtml(b.title)}</a> (${formatDate(b.date)})</li>`).join('');
    return `
      <article class="card company-card" id="${escapeHtml(c.id)}">
        <div class="company-badges"><span class="badge badge-region">${escapeHtml(titleCase(c.region))}</span><span class="badge badge-type">${escapeHtml(titleCase(c.type))}</span></div>
        <h3><a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.name)}</a></h3>
        <p>${escapeHtml(c.description)}</p>
        ${c.notes ? `<p><em>${escapeHtml(c.notes)}</em></p>` : ''}
        <p class="breach-count ${relatedBreaches.length === 0 ? 'none' : ''}">${relatedBreaches.length === 0 ? 'No known breaches' : relatedBreaches.length + ' known breach' + (relatedBreaches.length === 1 ? '' : 'es')}</p>
        ${relatedBreaches.length ? `<ul class="source-list">${breachLinksHtml}</ul>` : ''}
        <p class="company-link"><a href="${escapeHtml(c.website)}" target="_blank" rel="noopener noreferrer">Visit official website ↗</a></p>
      </article>
    `;
  }).join('');
}

/* ---------- Theme toggle (dark/light mode) ---------- */
const THEME_KEY = 'id-breach-tracker-theme';

function getCurrentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) {}
  updateThemeToggleUI(theme);
}

function updateThemeToggleUI(theme) {
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;
  toggleBtn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
  toggleBtn.setAttribute('aria-label', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  toggleBtn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
  toggleBtn.textContent = theme === 'dark' ? '☀' : '☾';
}

function initThemeToggle() {
  updateThemeToggleUI(getCurrentTheme());
  const toggleBtn = document.getElementById('theme-toggle');
  if (!toggleBtn) return;
  toggleBtn.addEventListener('click', () => {
    setTheme(getCurrentTheme() === 'dark' ? 'light' : 'dark');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  initThemeToggle();
  initHomepage();
  initBreachesPage();
  initCompaniesPage();
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
