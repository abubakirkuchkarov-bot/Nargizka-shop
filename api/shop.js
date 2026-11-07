// Vercel serverless entry: API и /uploads → requestListener из server.js
// Имя не index.js — иначе Vercel отдаёт эту функцию на «/» вместо public/index.html
module.exports = require('../server.js');
