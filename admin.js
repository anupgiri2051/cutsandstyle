(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => 'Rs. ' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const fmt12 = (t) => { const [h, m] = t.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
  const fmtDate = (d) => new Date(d + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
  const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
  const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];

  // ---------- API ----------
  async function api(path, opts = {}) {
    const r = await fetch('/api' + path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : {},
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 && path !== '/admin/login') { showLogin(); throw new Error('Session expired'); }
    if (!r.ok) throw new Error(j.error || 'Request failed');
    return j;
  }

  let toastT;
  function toast(text, error) {
    const t = $('#toast'); t.textContent = text; t.className = 'toast show' + (error ? ' error' : '');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600);
  }

  // ---------- Modal ----------
  const modal = $('#modal');
  let onSave = null;
  function openModal(title, html, save, okText = 'Save') {
    $('#modal-title').textContent = title;
    $('#modal-content').innerHTML = html;
    $('#modal-err').textContent = '';
    $('#modal-ok').textContent = okText;
    onSave = save;
    modal.showModal();
    $('#modal-content input, #modal-content select, #modal-content textarea')?.focus();
  }
  $('#modal-form').addEventListener('submit', async (e) => {
    if (e.submitter?.value !== 'ok') return;
    e.preventDefault();
    const f = $('#modal-form');
    if (!f.reportValidity()) return;
    const btn = $('#modal-ok'); btn.disabled = true;
    try { await onSave(f); modal.close(); }
    catch (err) { $('#modal-err').textContent = err.message; }
    finally { btn.disabled = false; }
  });
  const formObj = (f) => Object.fromEntries($$('[name]', f).map((el) => [el.name, el.type === 'checkbox' ? el.checked : el.value]));

  // ---------- Auth ----------
  function showLogin() { $('#app-view').hidden = true; $('#login-view').hidden = false; $('#login-form [name=username]').focus(); }
  function showApp() { $('#login-view').hidden = true; $('#app-view').hidden = false; route(); }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('#login-err').textContent = '';
    try { await api('/admin/login', { method: 'POST', body: formObj(e.target) }); e.target.reset(); showApp(); }
    catch (err) { $('#login-err').textContent = err.message; }
  });
  $('#logout').addEventListener('click', async () => { await api('/admin/logout', { method: 'POST' }).catch(() => {}); showLogin(); });

  // ---------- Router ----------
  const titles = { dashboard: 'Dashboard', appointments: 'Appointments', services: 'Services', barbers: 'Barbers', gallery: 'Gallery', messages: 'Messages', settings: 'Settings' };
  window.addEventListener('hashchange', route);
  $('#menu-btn').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#sidebar').addEventListener('click', (e) => { if (e.target.closest('a')) $('#sidebar').classList.remove('open'); });

  async function route() {
    const views = { dashboard, appointments, services, barbers, gallery, messages, settings };
    const name = (location.hash.slice(1) || 'dashboard').split('?')[0];
    const view = views[name] ? name : 'dashboard';
    $$('.sidebar nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
    $('#view-title').textContent = titles[view];
    $('#view-actions').innerHTML = '';
    $('#view').innerHTML = '<p class="muted">Loading…</p>';
    try { await views[view](); } catch (err) { if (err.message !== 'Session expired') $('#view').innerHTML = `<p class="err">${esc(err.message)}</p>`; }
    refreshBadges();
  }

  async function refreshBadges() {
    try {
      const d = await api('/admin/dashboard');
      $('#badge-pending').textContent = d.pendingCount || '';
      $('#badge-msg').textContent = d.unreadMessages || '';
    } catch {}
  }

  const pill = (s) => `<span class="pill s-${s}">${s}</span>`;
  const statusSelect = (a) => `<select class="status" data-status="${a.id}">${STATUSES.map((s) => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}</select>`;

  function bindStatus(root, after) {
    $$('[data-status]', root).forEach((sel) => sel.addEventListener('change', async () => {
      try { await api(`/admin/appointments/${sel.dataset.status}/status`, { method: 'PATCH', body: { status: sel.value } }); toast('Status updated'); after(); }
      catch (err) { toast(err.message, true); after(); }
    }));
  }

  // ---------- Dashboard ----------
  async function dashboard() {
    const d = await api('/admin/dashboard');
    $('#view-actions').innerHTML = '<button class="btn btn-gold" id="new-appt">+ New appointment</button>';
    $('#new-appt').onclick = () => editAppointment(null, dashboard);
    const today = localDate();
    $('#view').innerHTML = `
      <div class="stats">
        <div class="stat"><span>Today's bookings</span><strong>${d.todayCount}</strong></div>
        <div class="stat"><span>Pending confirmation</span><strong>${d.pendingCount}</strong></div>
        <div class="stat"><span>Revenue this month</span><strong>${money(d.monthRevenue)}</strong></div>
        <div class="stat"><span>Unread messages</span><strong>${d.unreadMessages}</strong></div>
        <div class="stat"><span>Total clients</span><strong>${d.totalClients}</strong></div>
      </div>
      <div>
        <div class="section-title"><h2>Upcoming appointments</h2><a href="#appointments">View all →</a></div>
        <div class="table-wrap">${d.upcoming.length ? `<table>
          <thead><tr><th>When</th><th>Client</th><th>Service</th><th>Barber</th><th>Status</th></tr></thead>
          <tbody>${d.upcoming.map((a) => `<tr>
            <td><strong>${a.date === today ? 'Today' : fmtDate(a.date)}</strong><span class="sub">${fmt12(a.time)}</span></td>
            <td>${esc(a.name)}<span class="sub">${esc(a.phone)}</span></td>
            <td>${esc(a.serviceName)}<span class="sub">${money(a.price)}</span></td>
            <td>${esc(a.barberName)}</td>
            <td>${statusSelect(a)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No upcoming appointments.</div>'}
        </div>
      </div>`;
    bindStatus($('#view'), dashboard);
  }

  // ---------- Appointments ----------
  const apptFilter = { status: '', date: '', q: '' };
  async function appointments() {
    $('#view-actions').innerHTML = '<button class="btn btn-gold" id="new-appt">+ New appointment</button>';
    $('#new-appt').onclick = () => editAppointment(null, appointments);
    $('#view').innerHTML = `
      <div class="filters card">
        <label class="grow">Search <input id="f-q" placeholder="Name, phone or email" value="${esc(apptFilter.q)}"></label>
        <label>Date <input type="date" id="f-date" value="${apptFilter.date}"></label>
        <label>Status <select id="f-status"><option value="">All</option>${STATUSES.map((s) => `<option ${s === apptFilter.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <button class="btn btn-light" id="f-today">Today</button>
        <button class="btn btn-light" id="f-clear">Clear</button>
      </div>
      <div class="table-wrap" id="appt-table"></div>`;
    let t;
    $('#f-q').addEventListener('input', (e) => { apptFilter.q = e.target.value; clearTimeout(t); t = setTimeout(renderAppts, 250); });
    $('#f-date').addEventListener('change', (e) => { apptFilter.date = e.target.value; renderAppts(); });
    $('#f-status').addEventListener('change', (e) => { apptFilter.status = e.target.value; renderAppts(); });
    $('#f-today').onclick = () => { apptFilter.date = localDate(); $('#f-date').value = apptFilter.date; renderAppts(); };
    $('#f-clear').onclick = () => { Object.assign(apptFilter, { status: '', date: '', q: '' }); appointments(); };
    await renderAppts();
  }

  async function renderAppts() {
    const list = await api('/admin/appointments?' + new URLSearchParams(apptFilter));
    const el = $('#appt-table');
    if (!el) return;
    el.innerHTML = list.length ? `<table>
      <thead><tr><th>Date &amp; time</th><th>Client</th><th>Service</th><th>Barber</th><th>Status</th><th></th></tr></thead>
      <tbody>${list.map((a) => `<tr>
        <td><strong>${fmtDate(a.date)}</strong><span class="sub">${fmt12(a.time)} · ${a.duration} min</span></td>
        <td>${esc(a.name)}<span class="sub">${esc(a.phone)}${a.email ? ' · ' + esc(a.email) : ''}</span>${a.notes ? `<span class="sub">📝 ${esc(a.notes)}</span>` : ''}</td>
        <td>${esc(a.serviceName)}<span class="sub">${money(a.price)}</span></td>
        <td>${esc(a.barberName)}<span class="sub">${a.source === 'online' ? 'Online booking' : 'Added by staff'}</span></td>
        <td>${statusSelect(a)}</td>
        <td><div class="actions"><button class="btn btn-light btn-xs" data-edit="${a.id}">Edit</button><button class="btn btn-danger btn-xs" data-del="${a.id}">Delete</button></div></td>
      </tr>`).join('')}</tbody></table>` : '<div class="empty">No appointments match.</div>';
    bindStatus(el, renderAppts);
    $$('[data-edit]', el).forEach((b) => (b.onclick = () => editAppointment(list.find((a) => a.id === b.dataset.edit), renderAppts)));
    $$('[data-del]', el).forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this appointment permanently?')) return;
      await api('/admin/appointments/' + b.dataset.del, { method: 'DELETE' }); toast('Appointment deleted'); renderAppts(); refreshBadges();
    }));
  }

  async function editAppointment(a, after) {
    const [svcs, brbs] = await Promise.all([api('/admin/services'), api('/admin/barbers')]);
    if (!svcs.length || !brbs.length) return toast('Add at least one service and one barber first', true);
    const v = a || { date: localDate(), time: '10:00', status: 'confirmed', serviceId: svcs[0].id, barberId: brbs[0].id };
    openModal(a ? 'Edit appointment' : 'New appointment', `
      <div class="grid g2">
        <label>Client name <input name="name" required value="${esc(v.name)}"></label>
        <label>Phone <input name="phone" required value="${esc(v.phone)}"></label>
        <label>Email <input name="email" type="email" value="${esc(v.email)}"></label>
        <label>Status <select name="status">${STATUSES.map((s) => `<option ${s === v.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label>Service <select name="serviceId">${svcs.map((s) => `<option value="${s.id}" ${s.id === v.serviceId ? 'selected' : ''}>${esc(s.name)} (${money(s.price)})</option>`).join('')}</select></label>
        <label>Barber <select name="barberId">${brbs.map((b) => `<option value="${b.id}" ${b.id === v.barberId ? 'selected' : ''}>${esc(b.name)}${b.active ? '' : ' (inactive)'}</option>`).join('')}</select></label>
        <label>Date <input name="date" type="date" required value="${v.date}"></label>
        <label>Time <input name="time" type="time" required step="300" value="${v.time}"></label>
      </div>
      <label style="margin-top:.9rem">Notes <textarea name="notes" rows="2">${esc(v.notes)}</textarea></label>`,
    async (f) => {
      const body = formObj(f);
      if (a) await api('/admin/appointments/' + a.id, { method: 'PUT', body });
      else await api('/admin/appointments', { method: 'POST', body });
      toast(a ? 'Appointment updated' : 'Appointment created'); after(); refreshBadges();
    });
  }

  // ---------- Services & Barbers (shared list UI) ----------
  function listView({ path, label, columns, form, clean }) {
    return async function render() {
      const items = await api('/admin/' + path);
      $('#view-actions').innerHTML = `<button class="btn btn-gold" id="add-item">+ Add ${label}</button>`;
      $('#add-item').onclick = () => edit(null);
      $('#view').innerHTML = `<div class="table-wrap">${items.length ? `<table>
        <thead><tr><th style="width:70px">Order</th>${columns.map((c) => `<th>${c[0]}</th>`).join('')}<th>Status</th><th></th></tr></thead>
        <tbody>${items.map((it, i) => `<tr>
          <td><div class="actions" style="justify-content:flex-start">
            <button class="btn btn-light btn-xs" data-move="up" data-id="${it.id}" ${i === 0 ? 'disabled' : ''} aria-label="Move up">↑</button>
            <button class="btn btn-light btn-xs" data-move="down" data-id="${it.id}" ${i === items.length - 1 ? 'disabled' : ''} aria-label="Move down">↓</button></div></td>
          ${columns.map((c) => `<td>${c[1](it)}</td>`).join('')}
          <td>${it.active ? '<span class="pill s-completed">Visible</span>' : '<span class="pill s-off">Hidden</span>'}</td>
          <td><div class="actions"><button class="btn btn-light btn-xs" data-edit="${it.id}">Edit</button><button class="btn btn-danger btn-xs" data-del="${it.id}">Delete</button></div></td>
        </tr>`).join('')}</tbody></table>` : `<div class="empty">No ${label}s yet.</div>`}</div>`;
      $$('[data-move]').forEach((b) => (b.onclick = async () => { await api(`/admin/${path}/${b.dataset.id}/move`, { method: 'POST', body: { dir: b.dataset.move } }); render(); }));
      $$('[data-edit]').forEach((b) => (b.onclick = () => edit(items.find((x) => x.id === b.dataset.edit))));
      $$('[data-del]').forEach((b) => (b.onclick = async () => {
        if (!confirm(`Delete this ${label}? Existing appointments keep their details.`)) return;
        await api(`/admin/${path}/${b.dataset.del}`, { method: 'DELETE' }); toast(`${label[0].toUpperCase() + label.slice(1)} deleted`); render();
      }));
      function edit(it) {
        openModal(it ? `Edit ${label}` : `Add ${label}`, form(it || { active: true }), async (f) => {
          const body = clean(formObj(f));
          if (it) await api(`/admin/${path}/${it.id}`, { method: 'PUT', body });
          else await api(`/admin/${path}`, { method: 'POST', body });
          toast('Saved'); render();
        });
      }
    };
  }

  const services = listView({
    path: 'services', label: 'service',
    columns: [
      ['Service', (s) => `<strong>${esc(s.name)}</strong><span class="sub">${esc(s.description)}</span>`],
      ['Price', (s) => money(s.price)],
      ['Duration', (s) => `${s.duration} min`],
    ],
    form: (s) => `<div class="grid">
      <label>Name <input name="name" required maxlength="80" value="${esc(s.name)}"></label>
      <label>Description <textarea name="description" rows="2" maxlength="300">${esc(s.description)}</textarea></label>
      <div class="grid g2">
        <label>Price (Rs.) <input name="price" type="number" min="0" step="1" required value="${s.price ?? ''}"></label>
        <label>Duration (minutes) <input name="duration" type="number" min="5" max="480" step="5" required value="${s.duration ?? 30}"></label>
      </div>
      <label class="check"><input type="checkbox" name="active" ${s.active ? 'checked' : ''}> Show on website &amp; allow booking</label></div>`,
    clean: (b) => ({ ...b, price: Number(b.price), duration: Number(b.duration) }),
  });

  const barbers = listView({
    path: 'barbers', label: 'barber',
    columns: [
      ['Barber', (b) => `<strong>${esc(b.name)}</strong><span class="sub">${esc(b.title)}</span>`],
      ['Bio', (b) => `<span class="muted">${esc(b.bio)}</span>`],
    ],
    form: (b) => `<div class="grid">
      <div class="grid g2">
        <label>Name <input name="name" required maxlength="80" value="${esc(b.name)}"></label>
        <label>Title <input name="title" maxlength="60" placeholder="e.g. Senior Barber" value="${esc(b.title)}"></label>
      </div>
      <label>Bio <textarea name="bio" rows="3" maxlength="300">${esc(b.bio)}</textarea></label>
      <label class="check"><input type="checkbox" name="active" ${b.active ? 'checked' : ''}> Working &amp; bookable</label></div>`,
    clean: (b) => b,
  });

  // ---------- Gallery ----------
  async function gallery() {
    const items = await api('/admin/gallery');
    $('#view').innerHTML = `
      <label class="drop" id="drop">
        <strong>📷 Click to choose photos</strong> or drag &amp; drop them here
        <span class="muted">JPG, PNG or WebP · up to 8 MB each · they appear on the website's Gallery section</span>
        <input type="file" id="files" accept="image/jpeg,image/png,image/webp" multiple hidden>
      </label>
      <p class="muted" id="up-status"></p>
      ${items.length ? `<div class="gal">${items.map((g) => `
        <div class="gal-item"><img src="${esc(g.url)}" alt="">
          <div><input data-cap="${g.id}" value="${esc(g.caption)}" placeholder="Caption (optional)" maxlength="120">
          <button class="btn btn-danger btn-xs" data-del="${g.id}">Delete</button></div></div>`).join('')}</div>`
      : '<div class="card empty">No photos yet. The Gallery section stays hidden on the website until you add one.</div>'}`;
    const drop = $('#drop');
    const upload = async (files) => {
      files = [...files].filter((f) => /^image\/(jpeg|png|webp)$/.test(f.type));
      if (!files.length) return toast('Please choose JPG, PNG or WebP photos', true);
      let n = 0;
      for (const f of files) {
        $('#up-status').textContent = `Uploading ${++n} of ${files.length}…`;
        const r = await fetch('/api/admin/gallery', { method: 'POST', headers: { 'Content-Type': f.type }, body: f });
        if (!r.ok) { const j = await r.json().catch(() => ({})); toast(`${f.name}: ${j.error || 'upload failed'}`, true); }
      }
      toast('Photos uploaded'); gallery();
    };
    $('#files').addEventListener('change', (e) => upload(e.target.files));
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); upload(e.dataTransfer.files); });
    $$('[data-cap]').forEach((i) => i.addEventListener('change', async () => {
      await api('/admin/gallery/' + i.dataset.cap, { method: 'PUT', body: { caption: i.value } }); toast('Caption saved');
    }));
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this photo?')) return;
      await api('/admin/gallery/' + b.dataset.del, { method: 'DELETE' }); toast('Photo deleted'); gallery();
    }));
  }

  // ---------- Messages ----------
  async function messages() {
    const list = await api('/admin/messages');
    $('#view').innerHTML = list.length ? list.map((m) => `
      <article class="card msg ${m.read ? '' : 'unread'}">
        <header><div><strong>${esc(m.name)}</strong> · <a href="mailto:${esc(m.email)}">${esc(m.email)}</a></div>
        <span class="muted">${new Date(m.createdAt).toLocaleString()}</span></header>
        <p>${esc(m.message)}</p>
        <div class="actions" style="justify-content:flex-start">
          <a class="btn btn-light btn-xs" href="mailto:${esc(m.email)}?subject=${encodeURIComponent('Re: your message')}" style="text-decoration:none">Reply</a>
          <button class="btn btn-light btn-xs" data-read="${m.id}" data-v="${!m.read}">${m.read ? 'Mark unread' : 'Mark read'}</button>
          <button class="btn btn-danger btn-xs" data-del="${m.id}">Delete</button>
        </div>
      </article>`).join('') : '<div class="card empty">No messages yet.</div>';
    $$('[data-read]').forEach((b) => (b.onclick = async () => { await api('/admin/messages/' + b.dataset.read, { method: 'PATCH', body: { read: b.dataset.v === 'true' } }); messages(); refreshBadges(); }));
    $$('[data-del]').forEach((b) => (b.onclick = async () => {
      if (!confirm('Delete this message?')) return;
      await api('/admin/messages/' + b.dataset.del, { method: 'DELETE' }); toast('Message deleted'); messages(); refreshBadges();
    }));
  }

  // ---------- Settings ----------
  async function settings() {
    const s = await api('/admin/settings');
    $('#view').innerHTML = `
      <form class="card grid" id="shop-form">
        <div class="section-title"><h2>Shop information</h2></div>
        <div class="grid g2">
          <label>Shop name <input name="shopName" required value="${esc(s.shopName)}"></label>
          <label>Tagline <input name="tagline" value="${esc(s.tagline)}"></label>
          <label>Phone <input name="phone" value="${esc(s.phone)}"></label>
          <label>Email <input name="email" type="email" value="${esc(s.email)}"></label>
          <label>Address <input name="address" value="${esc(s.address)}"></label>
          <label>Instagram URL <input name="instagram" value="${esc(s.instagram)}"></label>
        </div>
        <label>About text <textarea name="about" rows="4">${esc(s.about)}</textarea></label>
        <label>Website accent colour
          <div class="swatches">${['#c39a4e', '#b3322b', '#2b6cb0', '#2f855a', '#805ad5', '#dd6b20', '#d53f8c', '#e2e8f0'].map((c) => `<button type="button" class="swatch ${c === s.accentColor ? 'on' : ''}" style="background:${c}" data-color="${c}" aria-label="${c}"></button>`).join('')}
          <input type="color" name="accentColor" value="${esc(s.accentColor || '#c39a4e')}" title="Custom colour"></div>
        </label>
        <div><button class="btn">Save shop info</button></div>
      </form>

      <form class="card" id="hours-form">
        <div class="section-title"><h2>Opening hours &amp; booking</h2></div>
        ${DAYS.map(([k, label]) => `<div class="hours-row">
          <strong>${label}</strong>
          <input type="time" name="${k}-open" value="${s.hours[k].open}">
          <input type="time" name="${k}-close" value="${s.hours[k].close}">
          <label class="check"><input type="checkbox" name="${k}-closed" ${s.hours[k].closed ? 'checked' : ''}> Closed</label>
        </div>`).join('')}
        <label style="margin-top:1rem;max-width:260px">Booking slot interval
          <select name="slotMinutes">${[10, 15, 20, 30, 45, 60].map((n) => `<option value="${n}" ${n === s.slotMinutes ? 'selected' : ''}>Every ${n} minutes</option>`).join('')}</select>
        </label>
        <div style="margin-top:1rem"><button class="btn">Save hours</button></div>
      </form>

      <form class="card grid" id="pw-form">
        <div class="section-title"><h2>Admin account</h2></div>
        <div class="grid g3">
          <label>Username <input name="username" autocomplete="username" placeholder="Leave blank to keep"></label>
          <label>Current password <input name="current" type="password" required autocomplete="current-password"></label>
          <label>New password <input name="next" type="password" required minlength="8" autocomplete="new-password"></label>
        </div>
        <div><button class="btn">Update login</button></div>
      </form>`;

    $$('.swatch').forEach((b) => (b.onclick = () => { $('[name=accentColor]').value = b.dataset.color; $$('.swatch').forEach((x) => x.classList.toggle('on', x === b)); }));
    $('#shop-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/admin/settings', { method: 'PUT', body: formObj(e.target) }); toast('Shop info saved'); } catch (err) { toast(err.message, true); }
    };
    $('#hours-form').onsubmit = async (e) => {
      e.preventDefault();
      const f = formObj(e.target);
      const hours = Object.fromEntries(DAYS.map(([k]) => [k, { open: f[`${k}-open`], close: f[`${k}-close`], closed: f[`${k}-closed`] }]));
      try { await api('/admin/settings', { method: 'PUT', body: { hours, slotMinutes: Number(f.slotMinutes) } }); toast('Hours saved'); } catch (err) { toast(err.message, true); }
    };
    $('#pw-form').onsubmit = async (e) => {
      e.preventDefault();
      try { await api('/admin/password', { method: 'PUT', body: formObj(e.target) }); e.target.reset(); toast('Login updated'); } catch (err) { toast(err.message, true); }
    };
  }

  // ---------- Boot ----------
  api('/admin/me').then(showApp).catch(showLogin);
})();
