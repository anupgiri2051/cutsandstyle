// Storage layer.
// - On your computer: saves everything to data/db.json (and photos to data/uploads/).
// - On Vercel: saves data to an Upstash Redis database (connect it in Vercel → Storage)
//   and photos to Vercel Blob. Vercel adds the needed environment variables automatically.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = path.join(path.dirname(FILE), 'uploads');

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const KV_KEY = process.env.DB_KEY || 'cuts-and-style:db';
const useKV = Boolean(KV_URL && KV_TOKEN);
const onVercel = Boolean(process.env.VERCEL);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

const newId = () => crypto.randomUUID();

function seed() {
  const day = (open, close) => ({ open, close, closed: false });
  return {
    settings: {
      shopName: 'Cuts & Style',
      tagline: 'Sharp cuts. Clean fades. Classic style.',
      about:
        'Cuts & Style is a neighbourhood barber shop built on old-school craft and modern technique. ' +
        'Whether you want a precision fade, a classic scissor cut or a hot-towel shave, our barbers take the time to get it right.',
      phone: '+977 98XXXXXXXX',
      email: 'hello@cutsandstyle.com',
      address: 'Baglung, Nepal',
      instagram: 'https://instagram.com/',
      slotMinutes: 30,
      accentColor: '#c39a4e',
      timezone: 'Asia/Kathmandu',
      hours: {
        mon: day('09:00', '19:00'),
        tue: day('09:00', '19:00'),
        wed: day('09:00', '19:00'),
        thu: day('09:00', '20:00'),
        fri: day('09:00', '20:00'),
        sat: day('08:00', '17:00'),
        sun: { open: '10:00', close: '15:00', closed: true },
      },
    },
    admin: {
      username: 'admin',
      password: hashPassword(process.env.ADMIN_PASSWORD || 'admin123'),
    },
    sessionSecret: crypto.randomBytes(32).toString('hex'),
    services: [
      { name: 'Classic Haircut', description: 'Scissor or clipper cut, styled to finish.', price: 300, duration: 30 },
      { name: 'Skin Fade', description: 'Seamless fade down to the skin with detailed line-up.', price: 400, duration: 45 },
      { name: 'Beard Trim & Shape', description: 'Beard sculpting, line-up and conditioning oil.', price: 200, duration: 30 },
      { name: 'Hot Towel Shave', description: 'Traditional straight-razor shave with hot towels.', price: 350, duration: 45 },
      { name: 'Cut & Beard Combo', description: 'Full haircut plus beard trim. Our most popular.', price: 600, duration: 60 },
      { name: 'Kids Cut (under 12)', description: 'Patient, friendly cuts for the little ones.', price: 200, duration: 30 },
    ].map((s, i) => ({ id: newId(), active: true, order: i, ...s })),
    barbers: [
      { name: 'Marcus Reed', title: 'Master Barber', bio: '15 years behind the chair. Fade specialist.' },
      { name: 'Leo Santos', title: 'Senior Barber', bio: 'Classic cuts, scissor work and beard design.' },
      { name: 'Jay Kim', title: 'Barber', bio: 'Modern textured styles and razor art.' },
    ].map((b, i) => ({ id: newId(), active: true, order: i, ...b })),
    testimonials: [
      { name: 'Daniel P.', text: 'Best fade I have ever had. Marcus is an artist.', rating: 5 },
      { name: 'Chris M.', text: 'Booked online in a minute, in and out on time. Great vibe.', rating: 5 },
      { name: 'Ahmed R.', text: 'The hot towel shave is a must. Proper old-school service.', rating: 5 },
    ].map((t) => ({ id: newId(), ...t })),
    appointments: [],
    messages: [],
    gallery: [],
  };
}

// Fill in fields added in later versions so older databases keep working.
function migrate(d) {
  let changed = false;
  const set = (obj, key, val) => { if (obj[key] === undefined) { obj[key] = val; changed = true; } };
  set(d, 'gallery', []);
  set(d, 'sessionSecret', crypto.randomBytes(32).toString('hex'));
  set(d.settings, 'accentColor', '#c39a4e');
  set(d.settings, 'timezone', 'Asia/Kathmandu');
  return changed;
}

async function kv(command) {
  const r = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Database error: ' + (j.error || r.status));
  return j.result;
}

let data = null;

// On Vercel, every request re-reads the database so all server copies stay in sync.
async function load() {
  if (useKV) {
    const raw = await kv(['GET', KV_KEY]);
    if (raw) {
      data = JSON.parse(raw);
      if (migrate(data)) await save();
    } else {
      data = seed();
      await save();
    }
    return data;
  }
  if (onVercel) {
    throw new Error('Database not connected. In Vercel, open your project → Storage → connect an Upstash Redis database, then redeploy.');
  }
  if (data) return data; // file mode: keep it in memory after the first read
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    if (migrate(data)) await save();
  } else {
    data = seed();
    await save();
    console.log('Created new database with demo data at', FILE);
  }
  return data;
}

async function save() {
  if (useKV) return kv(['SET', KV_KEY, JSON.stringify(data)]);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

// ---------- Photos ----------
const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

async function savePhoto(fileName, buffer, contentType) {
  if (useBlob) {
    const { put } = require('@vercel/blob');
    const blob = await put(`gallery/${fileName}`, buffer, { access: 'public', contentType, addRandomSuffix: false });
    return blob.url;
  }
  if (onVercel) throw new Error('Photo storage not connected. In Vercel, open your project → Storage → create a Blob store, then redeploy.');
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return '/uploads/' + fileName;
}

async function deletePhoto(item) {
  if (/^https?:\/\//.test(item.url || '')) {
    if (useBlob) await require('@vercel/blob').del(item.url).catch(() => {});
  } else if (item.file) {
    fs.rmSync(path.join(UPLOAD_DIR, path.basename(item.file)), { force: true });
  }
}

module.exports = {
  FILE, UPLOAD_DIR, load, save, get: () => data, newId, hashPassword, verifyPassword, savePhoto, deletePhoto,
  storage: () => ({ database: useKV ? 'redis' : onVercel ? 'missing' : 'file', photos: useBlob ? 'blob' : onVercel ? 'missing' : 'file' }),
};
