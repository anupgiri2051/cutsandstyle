// Simple JSON-file database with atomic writes. Good for a single shop.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'db.json');

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

let data;

function load() {
  if (fs.existsSync(FILE)) {
    data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    data.gallery ||= [];
    data.settings.accentColor ||= '#c39a4e';
  } else {
    data = seed();
    save();
    console.log('Created new database with demo data at', FILE);
  }
  return data;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

module.exports = { FILE, UPLOAD_DIR: path.join(path.dirname(FILE), 'uploads'), load, save, get: () => data, newId, hashPassword, verifyPassword };
