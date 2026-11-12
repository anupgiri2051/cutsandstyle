// Vercel runs files in the api/ folder as server functions.
// This hands every /api/* request to the Express app in server.js.
module.exports = require('../server.js');
