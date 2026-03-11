const http = require("http");
const https = require("https");

const host = "localhost";
const port = 8080;

http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    const targetUrl = request.url.startsWith("/") ? request.url.slice(1) : request.url;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Neplatná cílová URL" }));
        return;
    }

    const client = targetUrl.startsWith("https://") ? https : http;
    client.get(targetUrl, (upstream) => {
        response.writeHead(upstream.statusCode || 500, {
            "Content-Type": upstream.headers["content-type"] || "application/json; charset=utf-8"
        });
        upstream.pipe(response);
    }).on("error", (error) => {
        response.writeHead(502, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Proxy request failed", details: error.message }));
    });
}).listen(port, host, () => {
    console.log(`Proxy běží na http://${host}:${port}`);
});