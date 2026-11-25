
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 3000;
const GIPHY_API_KEY = process.env.GIPHY_API_KEY || "";

app.use(express.static("public"));

const users = new Map();
const chatHistory = [];
const voiceRooms = new Map();

const MAX_HISTORY = 100;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_USERNAME_LENGTH = 24;
const MAX_ROOM_LENGTH = 40;

// --------------------
// TEMİZLEME FONKSİYONLARI
// --------------------

function cleanName(value) {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_USERNAME_LENGTH);
}

function cleanText(value) {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .slice(0, MAX_MESSAGE_LENGTH);
}

function cleanRoomName(value) {
  if (typeof value !== "string") return "";

  return value
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, MAX_ROOM_LENGTH);
}

function getRoomKey(roomName) {
  return cleanRoomName(roomName).toLowerCase();
}

function getUsername(socketId) {
  return users.get(socketId) || "Kullanıcı";
}

function getVoiceRoom(socket) {
  return socket.data.voiceRoom || "";
}

function sendOnlineUsers() {
  const online = Array.from(users.values());

  io.emit("users:update", online);
  io.emit("users", online);
}

// --------------------
// GENEL SOHBET
// --------------------

function addChatMessage(username, text) {
  const message = {
    username,
    text,
    time: Date.now()
  };

  chatHistory.push(message);

  while (chatHistory.length > MAX_HISTORY) {
    chatHistory.shift();
  }

  io.emit("chat:message", message);
}

io.on("connection", socket => {
  console.log("Bağlandı:", socket.id);

  // --------------------
  // KULLANICI KAYDI
  // --------------------

  socket.on("user:join", value => {
    const username = cleanName(
      typeof value === "string"
        ? value
        : value?.username
    );

    if (!username) return;

    users.set(socket.id, username);
    socket.data.username = username;

    socket.emit("chat:history", chatHistory);

    sendOnlineUsers();

    const roomName = getVoiceRoom(socket);

    if (roomName) {
      sendHostStatus(socket, roomName);
    }
  });

  // --------------------
  // GENEL MESAJ
  // --------------------

  socket.on("chat:message", value => {
    if (!users.has(socket.id)) return;

    const text = cleanText(value);

    if (!text) return;

    addChatMessage(getUsername(socket.id), text);
  });

  // --------------------
  // GIF API
  // --------------------

  // Örnek:
  // /api/gifs?q=cats&offset=0

  app.get("/api/gifs", async (req, res) => {
    try {
      if (!GIPHY_API_KEY) {
        return res.status(500).json({
          error: "GIPHY_API_KEY Render ortam değişkenine eklenmemiş."
        });
      }

      const query = cleanText(req.query.q).slice(0, 100);

      const offset = Math.max(
        0,
        Math.min(
          9999,
          parseInt(req.query.offset, 10) || 0
        )
      );

      if (!query) {
        return res.json([]);
      }

      const apiUrl = new URL(
        "https://api.giphy.com/v1/gifs/search"
      );

      apiUrl.searchParams.set("api_key", GIPHY_API_KEY);
      apiUrl.searchParams.set("q", query);
      apiUrl.searchParams.set("limit", "50");
      apiUrl.searchParams.set("offset", String(offset));
      apiUrl.searchParams.set("rating", "pg");
      apiUrl.searchParams.set("lang", "tr");

      const response = await fetch(apiUrl);

      if (!response.ok) {
        return res.status(502).json({
          error: "GIPHY API isteği başarısız."
        });
      }

      const result = await response.json();

      const gifs = (result.data || [])
        .map(gif => ({
          id: gif.id,
          url:
            gif.images?.fixed_height?.url ||
            gif.images?.original?.url ||
            "",
          preview:
            gif.images?.fixed_height_small?.url ||
            gif.images?.preview_gif?.url ||
            ""
        }))
        .filter(gif => gif.url);

      res.json({
        gifs,
        offset,
        count: gifs.length,
        total: result.pagination?.total_count || 0
      });
    } catch (error) {
      console.error("GIF hatası:", error);

      res.status(500).json({
        error: "GIF araması sırasında hata oluştu."
      });
    }
  });

  // --------------------
  // SESLİ ODA YARDIMCILARI
  // --------------------

  function getRoom(roomName) {
    return voiceRooms.get(getRoomKey(roomName));
  }

  function getRoomMembers(roomName) {
    const room = getRoom(roomName);

    if (!room) return [];

    return Array.from(room.members)
      .filter(id => id !== socket.id);
  }

  function sendHostStatus(targetSocket, roomName) {
    const room = getRoom(roomName);

    if (!room) return;

    targetSocket.emit("voice:host-status", {
      roomName: room.name,
      isHost: room.hostId === targetSocket.id
    });
  }

  function sendRoomUsers(roomName) {
    const room = getRoom(roomName);

    if (!room) return;

    const roomUsers = Array.from(room.members).map(id => ({
      id,
      username: getUsername(id),
      isHost: id === room.hostId
    }));

    io.to(room.key).emit("voice:users", roomUsers);
    io.to(room.key).emit("voice:room-users", roomUsers);
  }

  function closeVoiceRoom(roomName) {
    const key = getRoomKey(roomName);
    const room = voiceRooms.get(key);

    if (!room) return;

    io.to(key).emit("voice:room-closed", {
      roomName: room.name
    });

    for (const memberId of room.members) {
      const memberSocket = io.sockets.sockets.get(memberId);

      if (memberSocket) {
        memberSocket.leave(key);
        memberSocket.data.voiceRoom = "";
        memberSocket.data.voiceRoomKey = "";
      }
    }

    voiceRooms.delete(key);

    console.log("Oda kapandı:", room.name);
  }

  function leaveVoiceRoom(targetSocket) {
    const roomName = targetSocket.data.voiceRoom;
    const roomKey = targetSocket.data.voiceRoomKey;

    if (!roomName || !roomKey) return;

    const room = voiceRooms.get(roomKey);

    targetSocket.data.voiceRoom = "";
    targetSocket.data.voiceRoomKey = "";

    targetSocket.leave(roomKey);

    if (!room) return;

    // Oda sahibi çıkarsa oda tamamen kapanır.
    if (room.hostId === targetSocket.id) {
      closeVoiceRoom(roomName);
      return;
    }

    room.members.delete(targetSocket.id);

    io.to(roomKey).emit("voice:peer-left", {
      id: targetSocket.id,
      username: getUsername(targetSocket.id)
    });

    sendRoomUsers(roomName);
  }

  // --------------------
  // ODA OLUŞTUR
  // --------------------

  socket.on("voice:create", (value, callback) => {
    if (!users.has(socket.id)) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Önce sohbete katılmalısın."
        });
      }

      return;
    }

    const requestedName = cleanRoomName(
      typeof value === "string"
        ? value
        : value?.roomName
    );

    const roomName =
      requestedName ||
      `${getUsername(socket.id)} Odası`;

    const key = getRoomKey(roomName);

    if (voiceRooms.has(key)) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Bu oda zaten var."
        });
      }

      return;
    }

    leaveVoiceRoom(socket);

    const room = {
      key,
      name: roomName,
      hostId: socket.id,
      hostName: getUsername(socket.id),
      members: new Set([socket.id]),
      videoId: ""
    };

    voiceRooms.set(key, room);

    socket.join(key);
    socket.data.voiceRoom = roomName;
    socket.data.voiceRoomKey = key;

    sendHostStatus(socket, roomName);
    sendRoomUsers(roomName);

    socket.emit("voice:room-joined", {
      roomName,
      hostId: socket.id,
      isHost: true,
      peers: []
    });

    if (typeof callback === "function") {
      callback({
        ok: true,
        roomName,
        hostId: socket.id,
        peers: []
      });
    }

    console.log("Oda oluşturuldu:", roomName);
  });

  // --------------------
  // ODAYA KATIL
  // --------------------

  socket.on("voice:join", (value, callback) => {
    if (!users.has(socket.id)) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Önce sohbete katılmalısın."
        });
      }

      return;
    }

    const roomName = cleanRoomName(
      typeof value === "string"
        ? value
        : value?.roomName
    );

    const key = getRoomKey(roomName);
    const room = voiceRooms.get(key);

    if (!room) {
      if (typeof callback === "function") {
        callback({
          ok: false,
          error: "Oda bulunamadı."
        });
      }

      return;
    }

    if (room.members.has(socket.id)) {
      if (typeof callback === "function") {
        callback({
          ok: true,
          roomName: room.name,
          hostId: room.hostId,
          peers: []
        });
      }

      return;
    }

    leaveVoiceRoom(socket);

    const peers = Array.from(room.members).map(id => ({
      id,
      username: getUsername(id)
    }));

    room.members.add(socket.id);

    socket.join(key);
    socket.data.voiceRoom = room.name;
    socket.data.voiceRoomKey = key;

    sendHostStatus(socket, room.name);

    socket.emit("voice:room-joined", {
      roomName: room.name,
      hostId: room.hostId,
      isHost: false,
      peers
    });

    // Yeni katılan kişiye mevcut oda videosunu gönder.
    if (room.videoId) {
      socket.emit("youtube:play", {
        videoId: room.videoId,
        username: room.hostName
      });
    }

    // Odadakilere yeni kişinin geldiğini bildir.
    socket.to(key).emit("voice:peer-joined", {
      id: socket.id,
      username: getUsername(socket.id)
    });

    sendRoomUsers(room.name);

    if (typeof callback === "function") {
      callback({
        ok: true,
        roomName: room.name,
        hostId: room.hostId,
        peers
      });
    }

    console.log(
      getUsername(socket.id),
      "odaya katıldı:",
      room.name
    );
  });

  // --------------------
  // WEBRTC SİNYALLEŞME
  // --------------------

  socket.on("voice:signal", data => {
    if (!data || typeof data !== "object") return;

    const roomName = getVoiceRoom(socket);
    const room = getRoom(roomName);

    if (!room) return;

    const targetId = data.to;

    if (
      typeof targetId !== "string" ||
      !room.members.has(targetId)
    ) {
      return;
    }

    io.to(targetId).emit("voice:signal", {
      from: socket.id,
      data: data.data
    });
  });

  // --------------------
  // ODA MESAJLARI
  // --------------------

  socket.on("voice:message", value => {
    const roomName = getVoiceRoom(socket);
    const room = getRoom(roomName);

    if (!room || !room.members.has(socket.id)) return;

    const text = cleanText(
      typeof value === "string"
        ? value
        : value?.text
    );

    if (!text) return;

    io.to(room.key).emit("voice:message", {
      username: getUsername(socket.id),
      text,
      time: Date.now()
    });
  });

  // --------------------
  // YOUTUBE VİDEO OYNAT
  // --------------------

  socket.on("youtube:play", value => {
    const roomName = getVoiceRoom(socket);
    const room = getRoom(roomName);

    if (!room) return;

    // Sadece oda sahibi video başlatabilir.
    if (room.hostId !== socket.id) {
      socket.emit("youtube:error", {
        error: "YouTube videosunu sadece oda sahibi başlatabilir."
      });

      return;
    }

    const videoId = cleanText(value?.videoId);

    // YouTube video ID kontrolü.
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      socket.emit("youtube:error", {
        error: "Geçersiz YouTube video ID."
      });

      return;
    }

    room.videoId = videoId;

    io.to(room.key).emit("youtube:play", {
      videoId,
      username: getUsername(socket.id)
    });

    console.log(
      "YouTube başlatıldı:",
      room.name,
      videoId
    );
  });

  // --------------------
  // YOUTUBE VİDEO KAPAT
  // --------------------

  socket.on("youtube:close", () => {
    const roomName = getVoiceRoom(socket);
    const room = getRoom(roomName);

    if (!room) return;

    // Sadece oda sahibi videoyu kapatabilir.
    if (room.hostId !== socket.id) {
      socket.emit("youtube:error", {
        error: "Videoyu sadece oda sahibi kapatabilir."
      });

      return;
    }

    room.videoId = "";

    io.to(room.key).emit("youtube:close");

    console.log("YouTube kapatıldı:", room.name);
  });

  // --------------------
  // ODA KAPAT / AYRIL
  // --------------------

  socket.on("voice:leave", () => {
    leaveVoiceRoom(socket);
  });

  socket.on("voice:close", () => {
    const roomName = getVoiceRoom(socket);
    const room = getRoom(roomName);

    if (!room) return;

    if (room.hostId === socket.id) {
      closeVoiceRoom(roomName);
    } else {
      leaveVoiceRoom(socket);
    }
  });

  // --------------------
  // BAĞLANTI KESİLİRSE
  // --------------------

  socket.on("disconnect", () => {
    console.log("Ayrıldı:", socket.id);

    leaveVoiceRoom(socket);

    users.delete(socket.id);

    sendOnlineUsers();
  });
});

// --------------------
// SUNUCU
// --------------------

server.listen(PORT, () => {
  console.log(`Chatbox çalışıyor: ${PORT}`);
});
