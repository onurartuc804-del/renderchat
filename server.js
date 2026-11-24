
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*"
  }
});

const PORT = process.env.PORT || 3000;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || "";

app.use(express.static("public"));

const users = new Map();
const chatHistory = [];
const voiceRooms = new Map();

const MAX_HISTORY = 100;

// ------------------------------
// YARDIMCI FONKSİYONLAR
// ------------------------------

function cleanName(value) {
  return String(value || "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, 24);
}

function cleanText(value, max = 1000) {
  return String(value || "")
    .trim()
    .slice(0, max);
}

function roomKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function sendUsers() {
  io.emit("users:update", [...users.values()]);
}

// ------------------------------
// SESLİ ODADAN AYRILMA
// ------------------------------

function leaveVoiceRoom(socket) {
  const key = socket.data.voiceRoom;

  if (!key) return;

  socket.data.voiceRoom = null;

  const room = voiceRooms.get(key);

  if (!room) return;

  room.members.delete(socket.id);
  socket.leave(key);

  // Oda sahibi ayrılırsa oda kapanır
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

  // Diğer kullanıcılara ayrılma bildir
  socket.to(key).emit("voice:peer-left", {
    id: socket.id
  });
}

// ------------------------------
// GIF ARAMA API
// 50'ŞER SONUÇ, 10.000'E KADAR
// ------------------------------

app.get("/api/gifs", async (req, res) => {
  try {
    if (!GIPHY_API_KEY) {
      return res.status(500).json({
        error: "GIPHY_API_KEY ayarlanmamış."
      });
    }

    const query = cleanText(req.query.q || "funny", 100);

    const limit = Math.min(
      50,
      Math.max(1, Number(req.query.limit) || 50)
    );

    const offset = Math.min(
      9999,
      Math.max(0, Number(req.query.offset) || 0)
    );

    const url = new URL(
      "https://api.giphy.com/v1/gifs/search"
    );

    url.searchParams.set("api_key", GIPHY_API_KEY);
    url.searchParams.set("q", query);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("rating", "pg");
    url.searchParams.set("lang", "tr");

    const response = await fetch(url);
    const result = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: result.message || "GIF araması başarısız."
      });
    }

    const gifs = (result.data || [])
      .map(gif => ({
        id: gif.id,
        title: gif.title || "",
        url: gif.images?.fixed_height?.url || "",
        preview:
          gif.images?.fixed_height_small?.url ||
          gif.images?.fixed_height?.url ||
          ""
      }))
      .filter(gif => gif.url);

    const apiTotal =
      Number(result.pagination?.total_count) || 0;

    const total = Math.min(10000, apiTotal);
    const nextOffset = offset + gifs.length;

    res.json({
      gifs,
      total,
      nextOffset,
      hasMore:
        gifs.length > 0 &&
        nextOffset < total &&
        nextOffset < 10000
    });

  } catch (error) {
    console.error("GIF hatası:", error);

    res.status(500).json({
      error: "GIF yüklenirken hata oluştu."
    });
  }
});

// ------------------------------
// SOCKET.IO
// ------------------------------

io.on("connection", socket => {
  socket.data.voiceRoom = null;

  // ----------------------------
  // KULLANICI GİRİŞİ
  // ----------------------------

  socket.on("user:join", name => {
    const username = cleanName(name);

    if (!username) return;

    users.set(socket.id, username);
    socket.data.username = username;

    socket.emit("chat:history", chatHistory);

    sendUsers();

    console.log(username + " bağlandı.");
  });

  // ----------------------------
  // GENEL SOHBET MESAJI
  // ----------------------------

  socket.on("chat:message", message => {
    const username = users.get(socket.id);

    if (!username) return;

    const text = cleanText(message, 1000);

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

  // ----------------------------
  // SESLİ ODA OLUŞTUR
  // ----------------------------

  socket.on("voice:create", callback => {
    const username = users.get(socket.id);

    if (!username) {
      return callback?.({
        ok: false,
        error: "Önce giriş yapmalısın."
      });
    }

    leaveVoiceRoom(socket);

    const key = roomKey(username);

    if (voiceRooms.has(key)) {
      return callback?.({
        ok: false,
        error: "Bu isimde bir sesli oda zaten var."
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

    console.log(username + " sesli oda açtı.");
  });

  // ----------------------------
  // SESLİ ODAYA KATIL
  // ----------------------------

  socket.on("voice:join", (hostName, callback) => {
    const username = users.get(socket.id);

    if (!username) {
      return callback?.({
        ok: false,
        error: "Önce giriş yapmalısın."
      });
    }

    const key = roomKey(hostName);
    const room = voiceRooms.get(key);

    if (!room) {
      return callback?.({
        ok: false,
        error: "Sesli oda bulunamadı."
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

    console.log(username + " " + room.hostName + " odasına katıldı.");
  });

  // ----------------------------
  // WEBRTC SİNYALLEŞME
  // ----------------------------

  socket.on("voice:signal", payload => {
    const key = socket.data.voiceRoom;
    const room = voiceRooms.get(key);

    if (!room || !payload || !payload.to) return;

    if (!room.members.has(payload.to)) return;

    io.to(payload.to).emit("voice:signal", {
      from: socket.id,
      data: payload.data
    });
  });

  // ----------------------------
  // SESLİ ODA MESAJLARI
  // ----------------------------

  socket.on("voice:message", message => {
    const key = socket.data.voiceRoom;
    const room = voiceRooms.get(key);
    const username = users.get(socket.id);

    if (!room || !username) return;

    const text = cleanText(message, 500);

    if (!text) return;

    io.to(key).emit("voice:message", {
      username,
      text,
      time: Date.now()
    });
  });

  // ----------------------------
  // SESLİ ODADAN ÇIK
  // ----------------------------

  socket.on("voice:leave", () => {
    leaveVoiceRoom(socket);
  });

  // ----------------------------
  // BAĞLANTI KESİLİRSE
  // ----------------------------

  socket.on("disconnect", () => {
    leaveVoiceRoom(socket);

    const username = users.get(socket.id);

    users.delete(socket.id);

    sendUsers();

    if (username) {
      console.log(username + " bağlantıyı kesti.");
    }
  });
});

// ------------------------------
// SUNUCUYU BAŞLAT
// ------------------------------

server.listen(PORT, "0.0.0.0", () => {
  console.log("================================");
  console.log("       CHATBOX AKTİF");
  console.log(" Port: " + PORT);
  console.log(" GIF: 10.000'e kadar");
  console.log(" Sesli sohbet: Aktif");
  console.log("================================");
});

