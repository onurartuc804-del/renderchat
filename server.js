const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.static("public"));

app.get("/api/gifs", async (req, res) => {
  const key = process.env.GIPHY_API_KEY;
  const query = String(req.query.q || "").trim().slice(0, 80);

  if (!key) {
    return res.status(503).json({
      error: "GIPHY_API_KEY is not set on the server."
    });
  }

  try {
    const endpoint = query
      ? `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&limit=24&rating=pg`
      : `https://api.giphy.com/v1/gifs/trending?api_key=${encodeURIComponent(key)}&limit=24&rating=pg`;

    const response = await fetch(endpoint);

    if (!response.ok) {
      return res.status(502).json({
        error: "GIF provider request failed."
      });
    }

    const data = await response.json();

    const gifs = (data.data || []).map(gif => ({
      id: gif.id,
      title: gif.title || "GIF",
      preview: gif.images?.fixed_width_small?.url,
      url: gif.images?.fixed_width?.url
    })).filter(gif => gif.preview && gif.url);

    res.json({ gifs });
  } catch (error) {
    res.status(500).json({
      error: "GIF search is unavailable."
    });
  }
});

const users = new Map();
const history = [];
const MAX_HISTORY = 60;

function cleanText(value, max = 500) {
  return String(value || "")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, max);
}

io.on("connection", socket => {
  socket.on("join", rawName => {
    if (users.has(socket.id)) return;

    const name = cleanText(rawName, 24) || "Guest";
    users.set(socket.id, name);

    socket.emit("chat:history", history);

    io.emit("users:update",
      Array.from(users.entries()).map(([id, username]) => ({
        id,
        username
      }))
    );

    io.emit("chat:system", {
      text: `${name} sohbete katıldı.`,
      time: Date.now()
    });
  });

  socket.on("chat:message", raw => {
    const username = users.get(socket.id);

    if (!username || !raw || typeof raw !== "object") return;

    const type = raw.type === "gif" ? "gif" : "text";
    let message;

    if (type === "gif") {
      const url = String(raw.url || "");

      if (!/^https:\/\/(media|i)\.giphy\.com\//i.test(url)) {
        return;
      }

      message = {
        id: `${socket.id}-${Date.now()}`,
        userId: socket.id,
        username,
        type,
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
        type,
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

  socket.on("disconnect", () => {
    const name = users.get(socket.id);
    if (!name) return;

    users.delete(socket.id);

    io.emit("users:update",
      Array.from(users.entries()).map(([id, username]) => ({
        id,
        username
      }))
    );

    io.emit("chat:system", {
      text: `${name} sohbetten ayrıldı.`,
      time: Date.now()
    });
  });
});

server.listen(PORT, () => {
  console.log(`Chatbox listening on ${PORT}`);
});
