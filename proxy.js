const cors_proxy = require('cors-anywhere');
const host = 'localhost';
const port = 8080;

cors_proxy.createServer({
    originWhitelist: [], // Povolit vše
    requireHeader: [],
    removeHeaders: ['cookie', 'cookie2']
}).listen(port, host, () => {
    console.log('Proxy běží na http://' + host + ':' + port);
});