const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

const history = [];
const users = new Map();

const MAX_HISTORY = 100;
const GIF_LIMIT = 50;

// GIPHY API
app.get("/api/gifs", async (req, res) => {
    const apiKey = process.env.GIPHY_API_KEY;

    if (!apiKey) {
        return res.status(500).json({
            error: "GIPHY_API_KEY ayarlanmamış."
        });
    }

    const query = String(req.query.q || "").trim().slice(0, 100);

    const offset = Math.max(
        0,
        Math.min(parseInt(req.query.offset || "0", 10) || 0, 4999)
    );

    try {
        const endpoint = query
            ? "https://api.giphy.com/v1/gifs/search"
            : "https://api.giphy.com/v1/gifs/trending";

        const params = new URLSearchParams({
            api_key: apiKey,
            limit: String(GIF_LIMIT),
            offset: String(offset),
            rating: "pg"
        });

        if (query) {
            params.set("q", query);
        }

        const response = await fetch(`${endpoint}?${params}`);

        if (!response.ok) {
            console.error("GIPHY error:", response.status);

            return res.status(502).json({
                error: "GIPHY isteği başarısız."
            });
        }

        const result = await response.json();

        const gifs = (result.data || [])
            .map(gif => {
                const images = gif.images || {};

                return {
                    id: gif.id,
                    title: gif.title || "GIF",
                    preview:
                        images.fixed_width_small?.url ||
                        images.fixed_width?.url,
                    url:
                        images.original?.url ||
                        images.fixed_width?.url
                };
            })
            .filter(gif => gif.preview && gif.url);

        res.json({
            gifs,
            nextOffset: offset + GIF_LIMIT,
            total: Number(result.pagination?.total_count || 0)
        });

    } catch (error) {
        console.error("GIF error:", error);

        res.status(500).json({
            error: "GIF yüklenemedi."
        });
    }
});

// Güvenli metin
function cleanText(value, maxLength = 500) {
    return String(value || "")
        .replace(/[<>]/g, "")
        .trim()
        .slice(0, maxLength);
}

// GIF URL kontrolü
function validGifUrl(value) {
    try {
        const url = new URL(String(value));

        return (
            url.protocol === "https:" &&
            /^media\d*\.giphy\.com$/i.test(url.hostname)
        );
    } catch {
        return false;
    }
}

// Kullanıcı listesi
function broadcastUsers() {
    const list = Array.from(users.entries()).map(([id, username]) => ({
        id,
        username
    }));

    io.emit("users:update", list);
}

// Socket.IO
io.on("connection", socket => {

    // Kullanıcı katılır
    socket.on("join", rawName => {
        if (users.has(socket.id)) return;

        const username = cleanText(rawName, 24) || "Guest";

        users.set(socket.id, username);

        socket.emit("chat:history", history);

        broadcastUsers();

        io.emit("chat:system", {
            text: `${username} sohbete katıldı.`,
            time: Date.now()
        });
    });

    // Mesaj gönderme
    socket.on("chat:message", raw => {
        const username = users.get(socket.id);

        if (!username || !raw || typeof raw !== "object") {
            return;
        }

        const type = raw.type === "gif" ? "gif" : "text";

        let message;

        if (type === "gif") {
            const url = String(raw.url || "");

            if (!validGifUrl(url)) {
                console.log("GIF URL rejected:", url);
                return;
            }

            message = {
                id: `${socket.id}-${Date.now()}`,
                userId: socket.id,
                username,
                type: "gif",
                url,
                title: cleanText(raw.title, 100),
                time: Date.now()
            };

        } else {
            const text = cleanText(raw.text, 1000);

            if (!text) return;

            message = {
                id: `${socket.id}-${Date.now()}`,
                userId: socket.id,
                username,
                type: "text",
                text,
                time: Date.now()
            };
        }

        history.push(message);

        if (history.length > MAX_HISTORY) {
            history.shift();
        }

        io.emit("chat:message", message);
    });

    // Kullanıcı ayrılır
    socket.on("disconnect", () => {
        const username = users.get(socket.id);

        if (!username) return;

        users.delete(socket.id);

        broadcastUsers();

        io.emit("chat:system", {
            text: `${username} sohbetten ayrıldı.`,
            time: Date.now()
        });
    });
});

server.listen(PORT, () => {
    console.log(`Chatbox running on port ${PORT}`);
});
