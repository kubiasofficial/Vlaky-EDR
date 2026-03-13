const http = require("http");
const https = require("https");
const { URL } = require("url");

const host = "localhost";
const port = 8080;

function extractSteamName(xmlRaw) {
    const xml = String(xmlRaw || "");
    const cdataMatch = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/i);
    if (cdataMatch?.[1]) return cdataMatch[1].trim();

    const plainMatch = xml.match(/<steamID>(.*?)<\/steamID>/i);
    if (plainMatch?.[1]) return plainMatch[1].trim();

    return "";
}

function sendJson(response, statusCode, payload) {
    response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(payload));
}

function fetchText(targetUrl) {
    return new Promise((resolve, reject) => {
        const client = targetUrl.startsWith("https://") ? https : http;
        const request = client.get(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0"
            }
        }, (upstream) => {
            let raw = "";
            upstream.setEncoding("utf8");
            upstream.on("data", (chunk) => {
                raw += chunk;
            });
            upstream.on("end", () => {
                if ((upstream.statusCode || 500) >= 400) {
                    reject(new Error(`HTTP ${upstream.statusCode}`));
                    return;
                }
                resolve(raw);
            });
        });

        request.on("error", reject);
    });
}

http.createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
    }

    const requestUrl = new URL(request.url, `http://${host}:${port}`);
    if (requestUrl.pathname === "/steam-name") {
        const steamId = String(requestUrl.searchParams.get("steamId") || "").trim();
        if (!steamId || steamId === "0") {
            sendJson(response, 400, { error: "Chybí steamId" });
            return;
        }

        const target = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}/?xml=1`;
        fetchText(target)
            .then((xmlRaw) => {
                const name = extractSteamName(xmlRaw);
                sendJson(response, 200, { steamId, name: name && name.toLowerCase() !== "private profile" ? name : null });
            })
            .catch((error) => {
                sendJson(response, 502, { error: "Steam lookup failed", details: error.message });
            });
        return;
    }

    const targetUrl = request.url.startsWith("/") ? request.url.slice(1) : request.url;
    if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
        sendJson(response, 400, { error: "Neplatná cílová URL" });
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