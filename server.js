const express = require('express');
const path = require('path');
const crypto = require('crypto');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];

app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));
// On your computer Express serves the website. On Vercel the "public" folder is served automatically.
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(db.UPLOAD_DIR, { maxAge: '7d' }));
app.get('/admin', (req, res) => res.redirect('/admin/'));

// Load the latest data before every API request.
app.use('/api', async (req, res, next) => { await db.load(); next(); });

// ---------- helpers ----------
const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const toTime = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + 'T00:00:00Z'));
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const validZone = (tz) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

// "Now" in the shop's own time zone (servers like Vercel run on UTC).
function shopNow() {
  const tz = db.get().settings.timezone;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: validZone(tz) ? tz : 'Asia/Kathmandu', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}
const todayStr = () => shopNow().date;

function dayHours(date) {
  return db.get().settings.hours[DAYS[new Date(date + 'T00:00:00Z').getUTCDay()]];
}

function barberBusy(barberId, date, start, duration, ignoreId) {
  return db.get().appointments.some((a) =>
    a.barberId === barberId && a.date === date && a.status !== 'cancelled' && a.id !== ignoreId &&
    toMin(a.time) < start + duration && start < toMin(a.time) + a.duration);
}

// Free slots for a date/service/(optional) barber: [{ time, barberIds[] }]
function availability(date, service, barberId) {
  const h = dayHours(date);
  if (!h || h.closed) return [];
  const step = Number(db.get().settings.slotMinutes) || 30;
  const barbers = db.get().barbers.filter((b) => b.active && (!barberId || b.id === barberId));
  const now = shopNow();
  const earliest = date === now.date ? now.minutes + 15 : -1;
  const slots = [];
  for (let t = toMin(h.open); t + service.duration <= toMin(h.close); t += step) {
    if (t < earliest) continue;
    const free = barbers.filter((b) => !barberBusy(b.id, date, t, service.duration)).map((b) => b.id);
    if (free.length) slots.push({ time: toTime(t), barberIds: free });
  }
  return slots;
}

const photoUrl = (g) => g.url || '/uploads/' + g.file;

// ---------- auth (signed cookie, works on Vercel too) ----------
const SESSION_MS = 8 * 60 * 60 * 1000;
const loginAttempts = new Map(); // ip -> { count, until } (best effort)

function sign(expires) {
  const d = db.get();
  // Including the password hash means changing the password signs everyone out.
  return crypto.createHmac('sha256', d.sessionSecret).update(`${expires}.${d.admin.password}`).digest('hex');
}
function cookie(req, value, maxAge) {
  const secure = req.secure ? '; Secure' : '';
  return `cs_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}
function requireAuth(req, res, next) {
  const m = /(?:^|;\s*)cs_session=(\d+)\.([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m || Number(m[1]) < Date.now()) return bad(res, 'Not logged in', 401);
  const expected = Buffer.from(sign(m[1]), 'hex');
  if (!crypto.timingSafeEqual(expected, Buffer.from(m[2], 'hex'))) return bad(res, 'Not logged in', 401);
  next();
}

app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  const att = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (att.until > Date.now()) return bad(res, 'Too many attempts. Try again in a few minutes.', 429);
  const { username, password } = req.body || {};
  const admin = db.get().admin;
  if (username !== admin.username || !db.verifyPassword(password || '', admin.password)) {
    att.count += 1;
    if (att.count >= 5) { att.until = Date.now() + 5 * 60 * 1000; att.count = 0; }
    loginAttempts.set(ip, att);
    return bad(res, 'Invalid username or password', 401);
  }
  loginAttempts.delete(ip);
  const expires = Date.now() + SESSION_MS;
  res.setHeader('Set-Cookie', cookie(req, `${expires}.${sign(expires)}`, SESSION_MS / 1000));
  res.json({ ok: true, username: admin.username });
});

app.post('/api/admin/logout', (req, res) => {
  res.setHeader('Set-Cookie', cookie(req, '', 0));
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => res.json({ username: db.get().admin.username }));

// ---------- public API ----------
app.get('/api/public', (req, res) => {
  const d = db.get();
  res.json({
    settings: d.settings,
    today: todayStr(),
    services: d.services.filter((s) => s.active).sort((a, b) => a.order - b.order),
    barbers: d.barbers.filter((b) => b.active).sort((a, b) => a.order - b.order)
      .map(({ id, name, title, bio }) => ({ id, name, title, bio })),
    testimonials: d.testimonials,
    gallery: d.gallery.map((g) => ({ id: g.id, url: photoUrl(g), caption: g.caption })),
  });
});

app.get('/api/availability', (req, res) => {
  const { date, serviceId, barberId } = req.query;
  if (!isDate(date)) return bad(res, 'Invalid date');
  if (date < todayStr()) return res.json({ slots: [] });
  const service = db.get().services.find((s) => s.id === serviceId && s.active);
  if (!service) return bad(res, 'Choose a service');
  res.json({ slots: availability(date, service, barberId || null).map((s) => s.time) });
});

app.post('/api/appointments', async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100), phone = str(b.phone, 40), email = str(b.email, 120), notes = str(b.notes, 500);
  if (!name || !phone) return bad(res, 'Name and phone are required');
  if (!isDate(b.date) || b.date < todayStr()) return bad(res, 'Please choose a valid date');
  if (!isTime(b.time)) return bad(res, 'Please choose a time');
  const d = db.get();
  const service = d.services.find((s) => s.id === b.serviceId && s.active);
  if (!service) return bad(res, 'Please choose a service');
  const slot = availability(b.date, service, b.barberId || null).find((s) => s.time === b.time);
  if (!slot) return bad(res, 'Sorry, that time is no longer available. Please pick another.', 409);
  const barberId = slot.barberIds[0];
  const appt = {
    id: db.newId(), name, phone, email, notes, date: b.date, time: b.time,
    serviceId: service.id, serviceName: service.name, price: service.price, duration: service.duration,
    barberId, barberName: d.barbers.find((x) => x.id === barberId).name,
    status: 'pending', source: 'online', createdAt: new Date().toISOString(),
  };
  d.appointments.push(appt);
  await db.save();
  res.status(201).json({ ok: true, appointment: { date: appt.date, time: appt.time, barberName: appt.barberName, serviceName: appt.serviceName } });
});

app.post('/api/messages', async (req, res) => {
  const b = req.body || {};
  const name = str(b.name, 100), email = str(b.email, 120), message = str(b.message, 2000);
  if (!name || !email || !message) return bad(res, 'All fields are required');
  db.get().messages.push({ id: db.newId(), name, email, message, read: false, createdAt: new Date().toISOString() });
  await db.save();
  res.status(201).json({ ok: true });
});

// ---------- admin API ----------
const admin = express.Router();
admin.use(requireAuth);

admin.get('/dashboard', (req, res) => {
  const d = db.get();
  const today = todayStr();
  const active = d.appointments.filter((a) => a.status !== 'cancelled');
  const month = today.slice(0, 7);
  const upcoming = active.filter((a) => a.date > today || (a.date === today && a.status !== 'completed'))
    .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).slice(0, 8);
  res.json({
    today,
    todayCount: active.filter((a) => a.date === today).length,
    pendingCount: d.appointments.filter((a) => a.status === 'pending').length,
    monthRevenue: d.appointments.filter((a) => a.status === 'completed' && a.date.startsWith(month)).reduce((s, a) => s + a.price, 0),
    unreadMessages: d.messages.filter((m) => !m.read).length,
    totalClients: new Set(d.appointments.map((a) => a.phone)).size,
    storage: db.storage(),
    upcoming,
  });
});

// Appointments
admin.get('/appointments', (req, res) => {
  let list = [...db.get().appointments];
  const { status, date, q } = req.query;
  if (status) list = list.filter((a) => a.status === status);
  if (date) list = list.filter((a) => a.date === date);
  if (q) { const s = String(q).toLowerCase(); list = list.filter((a) => [a.name, a.phone, a.email].some((v) => (v || '').toLowerCase().includes(s))); }
  list.sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  res.json(list);
});

function validateAdminAppt(b, ignoreId) {
  const d = db.get();
  const name = str(b.name, 100), phone = str(b.phone, 40);
  if (!name || !phone) return { error: 'Name and phone are required' };
  if (!isDate(b.date) || !isTime(b.time)) return { error: 'Valid date and time required' };
  const service = d.services.find((s) => s.id === b.serviceId);
  const barber = d.barbers.find((x) => x.id === b.barberId);
  if (!service || !barber) return { error: 'Choose a service and barber' };
  const status = b.status || 'confirmed';
  if (!STATUSES.includes(status)) return { error: 'Invalid status' };
  if (status !== 'cancelled' && barberBusy(barber.id, b.date, toMin(b.time), service.duration, ignoreId))
    return { error: `${barber.name} already has an appointment at that time` };
  return {
    value: {
      name, phone, email: str(b.email, 120), notes: str(b.notes, 500), date: b.date, time: b.time,
      serviceId: service.id, serviceName: service.name, price: Number(b.price ?? service.price) || 0, duration: service.duration,
      barberId: barber.id, barberName: barber.name, status,
    },
  };
}

admin.post('/appointments', async (req, res) => {
  const r = validateAdminAppt(req.body || {});
  if (r.error) return bad(res, r.error);
  const appt = { id: db.newId(), ...r.value, source: 'admin', createdAt: new Date().toISOString() };
  db.get().appointments.push(appt);
  await db.save();
  res.status(201).json(appt);
});

admin.put('/appointments/:id', async (req, res) => {
  const a = db.get().appointments.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Not found', 404);
  const body = { ...a, ...req.body };
  if (req.body.serviceId && req.body.serviceId !== a.serviceId && req.body.price === undefined) delete body.price;
  const r = validateAdminAppt(body, a.id);
  if (r.error) return bad(res, r.error);
  Object.assign(a, r.value);
  await db.save();
  res.json(a);
});

admin.patch('/appointments/:id/status', async (req, res) => {
  const a = db.get().appointments.find((x) => x.id === req.params.id);
  if (!a) return bad(res, 'Not found', 404);
  const { status } = req.body || {};
  if (!STATUSES.includes(status)) return bad(res, 'Invalid status');
  if (a.status === 'cancelled' && status !== 'cancelled' && barberBusy(a.barberId, a.date, toMin(a.time), a.duration, a.id))
    return bad(res, 'That slot has been taken by another booking');
  a.status = status;
  await db.save();
  res.json(a);
});

admin.delete('/appointments/:id', async (req, res) => {
  const d = db.get();
  d.appointments = d.appointments.filter((x) => x.id !== req.params.id);
  await db.save();
  res.json({ ok: true });
});

// Generic CRUD for services & barbers
function crud(collection, clean) {
  admin.get(`/${collection}`, (req, res) => res.json([...db.get()[collection]].sort((a, b) => a.order - b.order)));
  admin.post(`/${collection}`, async (req, res) => {
    const r = clean(req.body || {});
    if (r.error) return bad(res, r.error);
    const list = db.get()[collection];
    const item = { id: db.newId(), order: list.length, ...r.value };
    list.push(item);
    await db.save();
    res.status(201).json(item);
  });
  admin.put(`/${collection}/:id`, async (req, res) => {
    const item = db.get()[collection].find((x) => x.id === req.params.id);
    if (!item) return bad(res, 'Not found', 404);
    const r = clean({ ...item, ...req.body });
    if (r.error) return bad(res, r.error);
    Object.assign(item, r.value);
    await db.save();
    res.json(item);
  });
  admin.delete(`/${collection}/:id`, async (req, res) => {
    const d = db.get();
    d[collection] = d[collection].filter((x) => x.id !== req.params.id);
    await db.save();
    res.json({ ok: true });
  });
  admin.post(`/${collection}/:id/move`, async (req, res) => {
    const list = [...db.get()[collection]].sort((a, b) => a.order - b.order);
    const i = list.findIndex((x) => x.id === req.params.id);
    const j = i + ((req.body || {}).dir === 'up' ? -1 : 1);
    if (i < 0 || j < 0 || j >= list.length) return res.json({ ok: true });
    [list[i], list[j]] = [list[j], list[i]];
    list.forEach((x, k) => { x.order = k; });
    await db.save();
    res.json({ ok: true });
  });
}

crud('services', (b) => {
  const name = str(b.name, 80);
  const price = Number(b.price), duration = Number(b.duration);
  if (!name) return { error: 'Name is required' };
  if (!(price >= 0)) return { error: 'Price must be 0 or more' };
  if (!(duration >= 5 && duration <= 480)) return { error: 'Duration must be 5–480 minutes' };
  return { value: { name, description: str(b.description, 300), price, duration: Math.round(duration), active: b.active !== false } };
});

crud('barbers', (b) => {
  const name = str(b.name, 80);
  if (!name) return { error: 'Name is required' };
  return { value: { name, title: str(b.title, 60), bio: str(b.bio, 300), active: b.active !== false } };
});

// Messages
admin.get('/messages', (req, res) => res.json([...db.get().messages].reverse()));
admin.patch('/messages/:id', async (req, res) => {
  const m = db.get().messages.find((x) => x.id === req.params.id);
  if (!m) return bad(res, 'Not found', 404);
  m.read = !!(req.body || {}).read;
  await db.save();
  res.json(m);
});
admin.delete('/messages/:id', async (req, res) => {
  const d = db.get();
  d.messages = d.messages.filter((x) => x.id !== req.params.id);
  await db.save();
  res.json({ ok: true });
});

// Gallery (photo uploads). The admin panel shrinks photos before sending, so they stay well under Vercel's 4.5 MB limit.
const IMG_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const withUrl = (g) => ({ ...g, url: photoUrl(g) });
admin.get('/gallery', (req, res) => res.json(db.get().gallery.map(withUrl)));
admin.post('/gallery', express.raw({ type: Object.keys(IMG_TYPES), limit: '4mb' }), async (req, res) => {
  const ext = IMG_TYPES[req.headers['content-type']];
  if (!ext || !Buffer.isBuffer(req.body) || !req.body.length) return bad(res, 'Please upload a JPG, PNG or WebP image');
  const id = db.newId();
  const file = `${id}.${ext}`;
  const url = await db.savePhoto(file, req.body, req.headers['content-type']);
  const item = { id, file, url, caption: str(req.query.caption, 120), createdAt: new Date().toISOString() };
  db.get().gallery.push(item);
  await db.save();
  res.status(201).json(item);
});
admin.put('/gallery/:id', async (req, res) => {
  const g = db.get().gallery.find((x) => x.id === req.params.id);
  if (!g) return bad(res, 'Not found', 404);
  g.caption = str((req.body || {}).caption, 120);
  await db.save();
  res.json(withUrl(g));
});
admin.delete('/gallery/:id', async (req, res) => {
  const d = db.get();
  const g = d.gallery.find((x) => x.id === req.params.id);
  if (g) await db.deletePhoto(withUrl(g));
  d.gallery = d.gallery.filter((x) => x.id !== req.params.id);
  await db.save();
  res.json({ ok: true });
});

// Settings
admin.get('/settings', (req, res) => res.json(db.get().settings));
admin.put('/settings', async (req, res) => {
  const b = req.body || {};
  const s = db.get().settings;
  for (const k of ['shopName', 'tagline', 'phone', 'email', 'address', 'instagram']) if (k in b) s[k] = str(b[k], 200);
  if ('about' in b) s.about = str(b.about, 1500);
  if ('accentColor' in b) {
    if (!/^#[0-9a-f]{6}$/i.test(b.accentColor)) return bad(res, 'Invalid colour');
    s.accentColor = b.accentColor;
  }
  if ('timezone' in b) {
    if (!validZone(b.timezone)) return bad(res, 'Unknown time zone');
    s.timezone = b.timezone;
  }
  if ('slotMinutes' in b) {
    const n = Number(b.slotMinutes);
    if (![10, 15, 20, 30, 45, 60].includes(n)) return bad(res, 'Invalid slot length');
    s.slotMinutes = n;
  }
  if (b.hours) {
    for (const day of Object.keys(s.hours)) {
      const h = b.hours[day];
      if (!h) continue;
      if (!h.closed && (!isTime(h.open) || !isTime(h.close) || toMin(h.open) >= toMin(h.close)))
        return bad(res, `Invalid hours for ${day}`);
      s.hours[day] = { open: h.open, close: h.close, closed: !!h.closed };
    }
  }
  await db.save();
  res.json(s);
});

admin.put('/password', async (req, res) => {
  const { current, next, username } = req.body || {};
  const a = db.get().admin;
  if (!db.verifyPassword(current || '', a.password)) return bad(res, 'Current password is incorrect');
  if (!next || String(next).length < 8) return bad(res, 'New password must be at least 8 characters');
  a.password = db.hashPassword(String(next));
  if (username && str(username, 40)) a.username = str(username, 40);
  await db.save();
  res.json({ ok: true });
});

app.use('/api/admin', admin);
app.use('/api', (req, res) => bad(res, 'Not found', 404));

// Errors: show a clear message instead of crashing.
app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, 'File is too large', 413);
  console.error(err);
  if (res.headersSent) return next(err);
  bad(res, err.message || 'Something went wrong', 500);
});

// Run directly on your computer with "npm start". On Vercel the app is imported instead.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Cuts & Style running at http://localhost:${PORT}`);
    console.log(`Admin panel:          http://localhost:${PORT}/admin`);
  });
}

module.exports = app;
