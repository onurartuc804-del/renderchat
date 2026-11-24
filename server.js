const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || "";

app.use(express.static("public"));

const users = new Map();
const chatHistory = [];
const voiceRooms = new Map();

const MAX_HISTORY = 100;

function cleanName(value) {
  return String(value || "").trim().slice(0, 24);
}

function roomKey(value) {
  return String(value || "").trim().toLowerCase();
}

function sendUsers() {
  io.emit("users:update", [...users.values()]);
}

function leaveVoiceRoom(socket) {
  const key = socket.data.voiceRoom;
  if (!key) return;

  socket.data.voiceRoom = null;

  const room = voiceRooms.get(key);
  if (!room) return;

  room.members.delete(socket.id);
  socket.leave(key);

  // Oda sahibi çıkarsa oda kapanır
  if (room.hostId === socket.id) {
    for (const id of room.members) {
      const member = io.sockets.sockets.get(id);

      if (member) {
        member.data.voiceRoom = null;
        member.leave(key);
        member.emit("voice:room-closed");
      }
    }

    voiceRooms.delete(key);
    return;
  }

  socket.to(key).emit("voice:peer-left", {
    id: socket.id
  });
}

// GIPHY GIF arama
app.get("/api/gifs", async (req, res) => {
  try {
    if (!GIPHY_API_KEY) {
      return res.status(500).json({
        error: "Render ayarlarında GIPHY_API_KEY eksik."
      });
    }

    const query = String(req.query.q || "funny").slice(0, 100);

    const url = new URL("https://api.giphy.com/v1/gifs/search");
    url.searchParams.set("api_key", GIPHY_API_KEY);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", "24");
    url.searchParams.set("rating", "pg");

    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok) {
      return res.status(500).json({
        error: "GIF araması başarısız."
      });
    }

    const gifs = (result.data || []).map(gif => ({
      id: gif.id,
      title: gif.title,
      url: gif.images?.fixed_height?.url,
      preview: gif.images?.fixed_height_small?.url
    })).filter(gif => gif.url);

    res.json(gifs);
  } catch (error) {
    console.error("GIF error:", error);
    res.status(500).json({ error: "GIF arama hatası." });
  }
});

io.on("connection", socket => {
  socket.data.voiceRoom = null;

  // Genel sohbet giriş
  socket.on("user:join", name => {
    const username = cleanName(name);
    if (!username) return;

    users.set(socket.id, username);
    socket.data.username = username;

    socket.emit("chat:history", chatHistory);
    sendUsers();
  });

  // Genel sohbet mesajı
  socket.on("chat:message", message => {
    const username = users.get(socket.id);
    if (!username) return;

    const text = String(message || "").trim().slice(0, 1000);
    if (!text) return;

    const item = {
      username,
      text,
      time: Date.now()
    };

    chatHistory.push(item);
    if (chatHistory.length > MAX_HISTORY) {
      chatHistory.shift();
    }

    io.emit("chat:message", item);
  });

  // Sesli oda oluştur
  socket.on("voice:create", callback => {
    const username = users.get(socket.id);

    if (!username) {
      return callback?.({
        ok: false,
        error: "Önce Chatbox'a giriş yap."
      });
    }

    leaveVoiceRoom(socket);

    const key = roomKey(username);

    if (voiceRooms.has(key)) {
      return callback?.({
        ok: false,
        error: "Bu kullanıcı adına ait oda zaten açık."
      });
    }

    voiceRooms.set(key, {
      hostId: socket.id,
      hostName: username,
      members: new Set([socket.id])
    });

    socket.join(key);
    socket.data.voiceRoom = key;

    callback?.({
      ok: true,
      roomName: username,
      peers: []
    });
  });

  // Sesli odaya kullanıcı adıyla katıl
  socket.on("voice:join", (hostName, callback) => {
    const username = users.get(socket.id);

    if (!username) {
      return callback?.({
        ok: false,
        error: "Önce Chatbox'a giriş yap."
      });
    }

    const key = roomKey(hostName);
    const room = voiceRooms.get(key);

    if (!room) {
      return callback?.({
        ok: false,
        error: "Bu kullanıcı adına ait açık oda bulunamadı."
      });
    }

    if (room.members.has(socket.id)) {
      return callback?.({
        ok: false,
        error: "Zaten bu odadasın."
      });
    }

    leaveVoiceRoom(socket);

    const peers = [...room.members].map(id => ({
      id,
      name: users.get(id) || "Kullanıcı"
    }));

    room.members.add(socket.id);
    socket.join(key);
    socket.data.voiceRoom = key;

    socket.to(key).emit("voice:peer-joined", {
      id: socket.id,
      name: username
    });

    callback?.({
      ok: true,
      roomName: room.hostName,
      peers
    });
  });

  // WebRTC sinyallerini odadaki hedef kullanıcıya ilet
  socket.on("voice:signal", payload => {
    const key = socket.data.voiceRoom;
    const room = voiceRooms.get(key);

    if (!room || !payload?.to || !room.members.has(payload.to)) {
      return;
    }

    io.to(payload.to).emit("voice:signal", {
      from: socket.id,
      data: payload.data
    });
  });

  // Sesli oda yazılı sohbeti
  socket.on("voice:message", message => {
    const key = socket.data.voiceRoom;
    const room = voiceRooms.get(key);
    const username = users.get(socket.id);

    if (!room || !username) return;

    const text = String(message || "").trim().slice(0, 500);
    if (!text) return;

    io.to(key).emit("voice:message", {
      username,
      text,
      time: Date.now()
    });
  });

  socket.on("voice:leave", () => {
    leaveVoiceRoom(socket);
  });

  socket.on("disconnect", () => {
    leaveVoiceRoom(socket);
    users.delete(socket.id);
    sendUsers();
  });
});

server.listen(PORT, () => {
  console.log(`Chatbox çalışıyor: port ${PORT}`);
});
