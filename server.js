const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY;

app.use(express.static("public"));

app.get("/api/gifs", async (req, res) => {
  if (!GIPHY_API_KEY) {
    return res.status(503).json({
      error: "GIPHY API anahtarı ayarlanmamış."
    });
  }

  const q = String(req.query.q || "").trim().slice(0, 80);

  const endpoint = q
    ? "https://api.giphy.com/v1/gifs/search"
    : "https://api.giphy.com/v1/gifs/trending";

  const url = new URL(endpoint);

  url.searchParams.set("api_key", GIPHY_API_KEY);
  url.searchParams.set("limit", "18");
  url.searchParams.set("rating", "g");

  if (q) url.searchParams.set("q", q);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: "GIF araması başarısız oldu."
      });
    }

    const gifs = (data.data || []).map(gif => ({
      id: gif.id,
      title: gif.title || "GIF",
      url: gif.images?.fixed_width?.url,
      preview: gif.images?.fixed_width_small?.url
    })).filter(gif => gif.url && gif.preview);

    res.json({ gifs });
  } catch {
    res.status(500).json({
      error: "GIF'ler yüklenemedi."
    });
  }
});

const users = new Map();
const messages = [];

const MAX_MESSAGES = 50;

function cleanName(name) {
  return String(name || "Guest")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 20) || "Guest";
}

function sendUsers() {
  io.emit("users", [...users.values()]);
}

io.on("connection", socket => {

  socket.on("join", name => {
    if (users.has(socket.id)) return;

    name = cleanName(name);
    users.set(socket.id, name);

    socket.emit("history", messages);

    io.emit("system", `${name} sohbete katıldı`);

    sendUsers();
  });

  socket.on("chat-message", data => {
    if (!users.has(socket.id)) return;
    if (!data || typeof data !== "object") return;

    const name = users.get(socket.id);

    if (data.type === "gif") {
      let url;

      try {
        url = new URL(String(data.url || ""));
      } catch {
        return;
      }

      if (
        url.protocol !== "https:" ||
        !(url.hostname === "giphy.com" ||
          url.hostname.endsWith(".giphy.com"))
      ) {
        return;
      }

      const message = {
        id: Date.now() + "-" + socket.id,
        name,
        type: "gif",
        url: url.href,
        time: Date.now()
      };

      messages.push(message);

      if (messages.length > MAX_MESSAGES) {
        messages.shift();
      }

      io.emit("chat-message", message);
      return;
    }

    const text = String(data.text || "")
      .trim()
      .slice(0, 500);

    if (!text) return;

    const message = {
      id: Date.now() + "-" + socket.id,
      name,
      type: "text",
      text,
      time: Date.now()
    };

    messages.push(message);

    if (messages.length > MAX_MESSAGES) {
      messages.shift();
    }

    io.emit("chat-message", message);
  });

  socket.on("disconnect", () => {
    const name = users.get(socket.id);

    if (name) {
      users.delete(socket.id);

      io.emit("system", `${name} sohbetten ayrıldı`);

      sendUsers();
    }
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Chatbox çalışıyor: " + PORT);
});
