// Global ID & Age Verification Breach Tracker — main.js
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

async function initBreachesPage() {
  const listEl = document.getElementById('breach-list');
  if (!listEl) return;
  const [{ breaches }, { companies }] = await Promise.all([loadData('breaches'), loadData('companies')]);
  _allBreaches = breaches; _allCompanies = companies;
  populateFilterOptions(breaches, companies);
  renderBreachList(breaches, companies);
  document.getElementById('filter-region').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-severity').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-company').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-datatype').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-sort').addEventListener('change', applyBreachFilters);
  document.getElementById('filter-search').addEventListener('input', applyBreachFilters);
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
  const sort = document.getElementById('filter-sort').value;
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
  const severityRank = { low: 0, medium: 1, high: 2, critical: 3 };
  filtered.sort((a, b) => {
    if (sort === 'date-asc') return a.date < b.date ? -1 : 1;
    if (sort === 'severity-desc') return severityRank[b.severity] - severityRank[a.severity];
    if (sort === 'title-asc') return a.title.localeCompare(b.title);
    return a.date < b.date ? 1 : -1;
  });
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

async function initCheckPage() {
  const form = document.getElementById('check-form');
  if (!form) return;
  const [{ companies }, { breaches }] = await Promise.all([loadData('companies'), loadData('breaches')]);
  const companyGrid = document.getElementById('company-checkboxes');
  companies.slice().sort((a, b) => a.name.localeCompare(b.name)).forEach(c => {
    companyGrid.insertAdjacentHTML('beforeend', `<label class="checkbox-item"><input type="checkbox" name="company" value="${escapeHtml(c.id)}"> ${escapeHtml(c.name)}</label>`);
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); runCheck(companies, breaches); });
}

function runCheck(companies, breaches) {
  const resultsEl = document.getElementById('check-results');
  const selectedCompanies = [...document.querySelectorAll('#company-checkboxes input:checked')].map(i => i.value);
  const idType = document.getElementById('id-type').value;
  const region = document.getElementById('id-region').value;
  if (selectedCompanies.length === 0) {
    resultsEl.innerHTML = `<div class="result-banner warn">Please select at least one company or service you've used before checking.</div>`;
    resultsEl.scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const matchedBreaches = breaches.filter(b =>
    b.companies.some(cid => selectedCompanies.includes(cid)) &&
    (idType === 'any' || b.data_types.includes(idType)) &&
    (region === 'any' || b.affected_regions.includes('global') || b.affected_regions.includes(region))
  );
  const selectedNames = selectedCompanies.map(id => companyNameById(companies, id));
  if (matchedBreaches.length === 0) {
    resultsEl.innerHTML = `
      <div class="result-banner ok">Good news — we found no publicly documented breaches matching your selection (${escapeHtml(selectedNames.join(', '))}) for the criteria you chose.</div>
      <p>This does not guarantee your data was never exposed — many incidents are never publicly disclosed. See our <a href="faq.html">FAQ</a> for general steps you can take to protect your identity documents.</p>
    `;
  } else {
    const items = matchedBreaches.map(b => `
      <article class="breach-card">
        <div class="breach-card-top"><h3>${escapeHtml(b.title)}</h3>${severityBadge(b.severity)}</div>
        <p class="summary">${escapeHtml(b.summary)}</p>
        <p><strong>Data types exposed:</strong> ${b.data_types.map(titleCase).join(', ')}</p>
        <p><a href="breaches.html#${escapeHtml(b.id)}">View full breach details →</a></p>
      </article>
    `).join('');
    resultsEl.innerHTML = `
      <div class="result-banner warn">We found ${matchedBreaches.length} known breach${matchedBreaches.length === 1 ? '' : 'es'} matching companies you selected (${escapeHtml(selectedNames.join(', '))}).</div>
      <div class="breach-list">${items}</div>
      <h3>What you should do next</h3>
      <ul class="guidance-list">
        <li>Check whether the affected company has contacted you directly with specific guidance.</li>
        <li>Monitor for signs of identity theft, such as unfamiliar accounts, credit inquiries, or loan applications in your name.</li>
        <li>Consider a credit freeze or fraud alert with credit bureaus in your country, if available.</li>
        <li>If a government-issued ID (passport, driver's license, national ID) was exposed, contact the issuing authority to ask about reissuance or flagging.</li>
        <li>Be alert to phishing attempts that reference the breach to appear legitimate.</li>
        <li>Avoid reusing the same identity documents for verification with high-risk or unfamiliar services in the future where possible.</li>
      </ul>
    `;
  }
  resultsEl.scrollIntoView({ behavior: 'smooth' });
}

document.addEventListener('DOMContentLoaded', () => {
  initHomepage();
  initBreachesPage();
  initCompaniesPage();
  initCheckPage();
  const yearEl = document.getElementById('footer-year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();
});
