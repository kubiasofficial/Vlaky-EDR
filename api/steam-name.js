const https = require("https");

function sendJson(response, statusCode, payload) {
    response.status(statusCode).json(payload);
}

function fetchText(targetUrl) {
    return new Promise((resolve, reject) => {
        const request = https.get(targetUrl, {
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

function extractSteamName(xmlRaw) {
    const xml = String(xmlRaw || "");
    const cdataMatch = xml.match(/<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/i);
    if (cdataMatch?.[1]) return cdataMatch[1].trim();

    const plainMatch = xml.match(/<steamID>(.*?)<\/steamID>/i);
    if (plainMatch?.[1]) return plainMatch[1].trim();

    return "";
}

module.exports = async (request, response) => {
    if (request.method !== "GET") {
        sendJson(response, 405, { error: "Method not allowed" });
        return;
    }

    const steamId = String(request.query.steamId || "").trim();
    if (!steamId || steamId === "0") {
        sendJson(response, 400, { error: "Missing steamId" });
        return;
    }

    try {
        const target = `https://steamcommunity.com/profiles/${encodeURIComponent(steamId)}/?xml=1`;
        const xmlRaw = await fetchText(target);
        const name = extractSteamName(xmlRaw);
        sendJson(response, 200, {
            steamId,
            name: name && name.toLowerCase() !== "private profile" ? name : null
        });
    } catch (error) {
        sendJson(response, 502, {
            error: "Steam lookup failed",
            details: error.message
        });
    }
};
