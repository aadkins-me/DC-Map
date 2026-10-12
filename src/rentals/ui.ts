import './rentals.css';
import {
  BATH_OPTIONS,
  BED_OPTIONS,
  DEFAULT_CRITERIA,
  HASH_KEY,
  criteriaFromHash,
  encodeCriteria,
  isDefault,
  loadCriteria,
  loadSharePref,
  saveCriteria,
  saveSharePref,
  summarize,
  type RentalCriteria,
} from './criteria';
import { buildLinks, type RentalArea } from './links';

let criteria = loadCriteria();
let shareCriteria = loadSharePref();
let section: HTMLElement | null = null;
const listeners = new Set<() => void>();

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function setCriteria(next: RentalCriteria, rerender = true) {
  criteria = next;
  saveCriteria(criteria);
  if (rerender) renderForm();
  else if (section) {
    section.querySelector('[data-rent-summary]')!.textContent = summarize(criteria);
    section.querySelector<HTMLElement>('[data-rent-reset]')!.hidden = isDefault(criteria);
  }
  listeners.forEach((fn) => fn());
}

/** Hash fragment (with leading "&") to append to share links, or "" when sharing is off. */
export function rentalHashParam(): string {
  return shareCriteria ? `&${HASH_KEY}=${encodeCriteria(criteria)}` : '';
}

function applyFromHash(notify: (msg: string) => void) {
  const fromLink = criteriaFromHash(location.hash);
  if (fromLink && encodeCriteria(fromLink) !== encodeCriteria(criteria)) {
    setCriteria(fromLink);
    notify(`Rental criteria from link: ${summarize(fromLink)}`);
  }
}

// ---------- Panel section ----------
export function mountRentalCriteria(panelBody: HTMLElement, notify: (msg: string) => void) {
  section = document.createElement('section');
  section.className = 'rent-panel';
  section.id = 'rental-criteria';
  panelBody.insertBefore(section, panelBody.querySelector('.panel-foot'));

  section.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const beds = t.closest<HTMLElement>('[data-beds]')?.dataset.beds;
    if (beds !== undefined) setCriteria({ ...criteria, beds: Number(beds) });
    if (t.closest('[data-rent-reset]')) setCriteria({ ...DEFAULT_CRITERIA });
  });
  section.addEventListener('change', (e) => {
    const input = e.target as HTMLInputElement | HTMLSelectElement;
    switch (input.name) {
      case 'rent-den':
        setCriteria({ ...criteria, den: (input as HTMLInputElement).checked }, false);
        break;
      case 'rent-air':
        setCriteria({ ...criteria, centralAir: (input as HTMLInputElement).checked }, false);
        break;
      case 'rent-baths':
        setCriteria({ ...criteria, baths: Number(input.value) }, false);
        break;
      case 'rent-share':
        shareCriteria = (input as HTMLInputElement).checked;
        saveSharePref(shareCriteria);
        break;
    }
  });
  section.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    if (input.name !== 'rent-max') return;
    const digits = input.value.replace(/[^\d]/g, '');
    const value = digits ? Number(digits) : null;
    setCriteria({ ...criteria, maxRent: value && value > 0 ? value : null }, false);
  });
  section.addEventListener('focusout', (e) => {
    if ((e.target as HTMLInputElement).name === 'rent-max') renderForm();
  });

  renderForm();
  applyFromHash(notify);
  window.addEventListener('hashchange', () => applyFromHash(notify));
}

function renderForm() {
  if (!section) return;
  const c = criteria;
  section.innerHTML = `
    <div class="section-head">
      <h2>Rental criteria</h2>
      <button class="link-btn" data-rent-reset ${isDefault(c) ? 'hidden' : ''}>Reset</button>
    </div>
    <p class="rent-summary" data-rent-summary>${esc(summarize(c))}</p>
    <div class="rent-field">
      <span class="rent-label" id="rent-beds-label">Bedrooms, at least</span>
      <div class="segmented rent-beds" role="group" aria-labelledby="rent-beds-label">
        ${BED_OPTIONS.map((b) => `<button class="seg${b === c.beds ? ' is-active' : ''}" data-beds="${b}" aria-pressed="${b === c.beds}">${b === 0 ? 'Studio' : `${b}+`}</button>`).join('')}
      </div>
    </div>
    <label class="toggle rent-toggle">
      <span class="toggle-text"><span class="toggle-label">Plus a den or office</span><span class="toggle-hint">Searched as a keyword on most sites</span></span>
      <input type="checkbox" name="rent-den" ${c.den ? 'checked' : ''} />
      <span class="switch" aria-hidden="true"></span>
    </label>
    <div class="rent-row">
      <label class="rent-field">
        <span class="rent-label">Bathrooms, at least</span>
        <select name="rent-baths" class="rent-input">
          ${BATH_OPTIONS.map((b) => `<option value="${b}" ${b === c.baths ? 'selected' : ''}>${b}+</option>`).join('')}
        </select>
      </label>
      <label class="rent-field">
        <span class="rent-label">Max rent <span class="rent-optional">optional</span></span>
        <span class="rent-money">
          <span aria-hidden="true">$</span>
          <input name="rent-max" class="rent-input" inputmode="numeric" autocomplete="off" placeholder="No limit" value="${c.maxRent ?? ''}" aria-label="Maximum monthly rent in dollars" />
        </span>
      </label>
    </div>
    <label class="toggle rent-toggle">
      <span class="toggle-text"><span class="toggle-label">Central heat &amp; AC</span><span class="toggle-hint">A/C filter where offered, else “central air” keyword</span></span>
      <input type="checkbox" name="rent-air" ${c.centralAir ? 'checked' : ''} />
      <span class="switch" aria-hidden="true"></span>
    </label>
    <label class="rent-check">
      <input type="checkbox" name="rent-share" ${shareCriteria ? 'checked' : ''} />
      Include these criteria in share links
    </label>
    <p class="rent-note">Tap a neighborhood for rental searches. Sites round half baths and match den / central air by keyword, so double-check each listing.</p>`;
}

// ---------- Popup section ----------
export function rentalLinksElement(area: RentalArea, onEdit: () => void): HTMLElement {
  const el = document.createElement('div');
  el.className = 'rent-pop';
  const render = () => {
    const links = buildLinks(area, criteria);
    el.innerHTML = `
      <div class="pop-section rent-pop-head">
        <span>Rentals near ${esc(area.place)}</span>
        <button class="link-btn" data-rent-edit>Edit criteria</button>
      </div>
      <p class="rent-pop-crit">${esc(summarize(criteria))}</p>
      <div class="rent-grid">
        ${links
          .map(
            (l) => `
          <a class="rent-btn" style="--c:${l.color}" href="${esc(l.url)}" target="_blank" rel="noopener noreferrer" title="${esc(l.detail)}">
            <span class="rent-btn-name">${esc(l.label)}<span class="rent-ext" aria-hidden="true">↗</span></span>
            <span class="rent-btn-meta">${esc(l.short)}</span>
          </a>`,
          )
          .join('')}
      </div>
      <p class="rent-pop-note">Opens a new tab. Filters are approximate on some sites; double-check baths, den and A/C on each listing.</p>`;
    el.querySelector('[data-rent-edit]')!.addEventListener('click', onEdit);
  };
  render();
  listeners.add(render);
  const observer = new MutationObserver(() => {
    if (!el.isConnected) {
      listeners.delete(render);
      observer.disconnect();
    }
  });
  queueMicrotask(() => observer.observe(document.body, { childList: true, subtree: true }));
  return el;
}

export function focusRentalCriteria() {
  section?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  section?.classList.add('is-flash');
  window.setTimeout(() => section?.classList.remove('is-flash'), 1200);
}
