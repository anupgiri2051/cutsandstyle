(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
  const KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let data;

  // Nav
  const nav = $('#nav');
  const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
  window.addEventListener('scroll', onScroll); onScroll();
  const links = $('.nav-links'), toggle = $('.nav-toggle');
  toggle.addEventListener('click', () => { const o = links.classList.toggle('open'); toggle.setAttribute('aria-expanded', o); });
  $$('.nav-links a').forEach((a) => a.addEventListener('click', () => links.classList.remove('open')));
  $('#year').textContent = new Date().getFullYear();

  async function load() {
    try {
      data = await fetch('/api/public').then((r) => r.json());
    } catch { $('#services-list').innerHTML = '<p class="muted">Could not load services. Please refresh.</p>'; return; }
    const s = data.settings;
    document.title = `${s.shopName} — Barber Shop`;
    if (/^#[0-9a-f]{6}$/i.test(s.accentColor || '')) ['--gold', '--gold-2'].forEach((v) => document.documentElement.style.setProperty(v, s.accentColor));
    $$('[data-shop-name]').forEach((el) => (el.textContent = s.shopName));
    $$('[data-tagline]').forEach((el) => (el.textContent = s.tagline));
    $$('[data-about]').forEach((el) => (el.textContent = s.about));
    $$('[data-phone]').forEach((el) => (el.textContent = s.phone));
    $$('[data-email]').forEach((el) => (el.textContent = s.email));
    $$('[data-address]').forEach((el) => (el.textContent = s.address));
    $$('[data-phone-link]').forEach((el) => (el.href = 'tel:' + s.phone.replace(/[^\d+]/g, '')));
    $$('[data-email-link]').forEach((el) => (el.href = 'mailto:' + s.email));
    $$('[data-instagram]').forEach((el) => { if (/^https?:\/\//.test(s.instagram)) el.href = s.instagram; else el.closest('li').remove(); });

    // Hours
    const todayKey = KEYS[new Date().getDay()];
    $('#hours-table').innerHTML = DAYS.map(([k, label]) => {
      const h = s.hours[k];
      return `<tr class="${k === todayKey ? 'today' : ''}"><td>${label}</td><td>${h.closed ? '<span class="closed">Closed</span>' : `${fmt12(h.open)} – ${fmt12(h.close)}`}</td></tr>`;
    }).join('');
    const th = s.hours[todayKey];
    $('#today-status').textContent = th.closed ? 'Closed today' : `Open ${fmt12(th.open)} – ${fmt12(th.close)}`;

    // Services
    $('#services-list').innerHTML = data.services.map((x) => `
      <article class="service">
        <div class="service-top"><h3>${esc(x.name)}</h3><span class="price">${money(x.price)}</span></div>
        <p>${esc(x.description)}</p>
        <div class="service-foot"><span class="dur">⏱ ${x.duration} min</span><button class="link-btn" data-book="${x.id}">Book →</button></div>
      </article>`).join('') || '<p class="muted">No services listed yet.</p>';
    $$('[data-book]').forEach((b) => b.addEventListener('click', () => {
      form.serviceId.value = b.dataset.book; refreshSlots(); $('#book').scrollIntoView();
    }));

    // Team
    $('#team-list').innerHTML = data.barbers.map((b) => `
      <article class="barber">
        <div class="avatar">${esc(b.name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase())}</div>
        <h3>${esc(b.name)}</h3><div class="role">${esc(b.title)}</div><p>${esc(b.bio)}</p>
      </article>`).join('');

    // Gallery
    if (data.gallery.length) {
      $('#gallery').hidden = false; $('[data-gallery-link]').hidden = false;
      $('#gallery-list').innerHTML = data.gallery.map((g) => `
        <figure data-src="${esc(g.url)}" data-cap="${esc(g.caption)}" tabindex="0"><img src="${esc(g.url)}" alt="${esc(g.caption || 'Cuts & Style')}" loading="lazy">${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}</figure>`).join('');
      const lb = $('#lightbox');
      $$('#gallery-list figure').forEach((f) => {
        const open = () => { $('img', lb).src = f.dataset.src; $('p', lb).textContent = f.dataset.cap; lb.showModal(); };
        f.addEventListener('click', open); f.addEventListener('keydown', (e) => e.key === 'Enter' && open());
      });
      lb.addEventListener('click', () => lb.close());
    }

    // Reviews
    $('#reviews-list').innerHTML = data.testimonials.map((t) => `
      <figure class="review"><div class="stars">${'★'.repeat(t.rating)}</div>
      <blockquote>“${esc(t.text)}”</blockquote><figcaption>— ${esc(t.name)}</figcaption></figure>`).join('');

    // Booking selects
    form.serviceId.insertAdjacentHTML('beforeend', data.services.map((x) => `<option value="${x.id}">${esc(x.name)} — ${money(x.price)} (${x.duration} min)</option>`).join(''));
    form.barberId.insertAdjacentHTML('beforeend', data.barbers.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join(''));
  }

  // Booking
  const form = $('#book-form');
  const msg = $('#book-msg');
  form.date.min = localDate();
  form.date.value = localDate();

  async function refreshSlots() {
    const slotsEl = $('#slots');
    const sel = form.time;
    updateSummary();
    if (!form.serviceId.value || !form.date.value) {
      sel.disabled = true; sel.innerHTML = '<option value="">Pick service &amp; date first</option>'; slotsEl.innerHTML = ''; return;
    }
    sel.disabled = true; sel.innerHTML = '<option value="">Loading…</option>';
    const q = new URLSearchParams({ date: form.date.value, serviceId: form.serviceId.value, barberId: form.barberId.value });
    const { slots = [] } = await fetch('/api/availability?' + q).then((r) => r.json()).catch(() => ({}));
    if (!slots.length) {
      sel.innerHTML = '<option value="">No times available</option>';
      slotsEl.innerHTML = '<p class="muted" style="margin:0">No free times on this day — please try another date or barber.</p>';
      return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">Select a time</option>' + slots.map((t) => `<option value="${t}">${fmt12(t)}</option>`).join('');
    slotsEl.innerHTML = slots.map((t) => `<button type="button" class="slot" data-t="${t}">${fmt12(t)}</button>`).join('');
    $$('.slot', slotsEl).forEach((b) => b.addEventListener('click', () => { sel.value = b.dataset.t; syncSlots(); }));
  }
  function syncSlots() { $$('.slot').forEach((b) => b.classList.toggle('active', b.dataset.t === form.time.value)); updateSummary(); }
  function updateSummary() {
    const svc = data?.services.find((x) => x.id === form.serviceId.value);
    const parts = [];
    if (svc) parts.push(`${svc.name} · ${money(svc.price)}`);
    if (form.date.value) parts.push(new Date(form.date.value + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
    if (form.time.value) parts.push(fmt12(form.time.value));
    $('#book-summary').textContent = parts.join(' — ');
  }
  ['serviceId', 'barberId', 'date'].forEach((n) => form[n].addEventListener('change', refreshSlots));
  form.time.addEventListener('change', syncSlots);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'form-msg';
    if (!form.serviceId.value || !form.date.value || !form.time.value) return show(msg, 'Please choose a service, date and time.', false);
    if (!form.name.value.trim() || !form.phone.value.trim()) return show(msg, 'Please enter your name and phone number.', false);
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      const body = Object.fromEntries(new FormData(form));
      const r = await fetch('/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { show(msg, j.error || 'Booking failed.', false); refreshSlots(); return; }
      const a = j.appointment;
      show(msg, `✓ Booked! ${a.serviceName} with ${a.barberName} on ${new Date(a.date + 'T00:00').toLocaleDateString()} at ${fmt12(a.time)}. See you soon.`, true);
      ['name', 'phone', 'email', 'notes'].forEach((n) => (form[n].value = ''));
      refreshSlots();
    } catch { show(msg, 'Network error — please try again.', false); }
    finally { btn.disabled = false; }
  });

  // Contact
  const cform = $('#contact-form');
  cform.addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = $('#contact-msg');
    const body = Object.fromEntries(new FormData(cform));
    if (!body.name.trim() || !body.email.trim() || !body.message.trim()) return show(m, 'Please fill in all fields.', false);
    const r = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    if (r && r.ok) { show(m, '✓ Thanks! We will get back to you shortly.', true); cform.reset(); }
    else show(m, 'Could not send message. Please try again.', false);
  });

  function show(el, text, ok) { el.textContent = text; el.className = 'form-msg ' + (ok ? 'ok' : 'err'); }

  load().then(refreshSlots);
})();
