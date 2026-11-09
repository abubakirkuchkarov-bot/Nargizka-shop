// Запуск server.js как на Vercel (VERCEL_ENV задаётся снаружи): node scripts/test/serve.js <port>
const http = require('http');
http.createServer(require('../../server.js')).listen(+process.argv[2], () => console.log('listening', process.argv[2]));
