
"use strict";

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
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 24);
}

function cleanText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, 2000);
}

function cleanRoomName(value) {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, 40);
}

function roomKey(name) {
  return cleanRoomName(name).toLowerCase();
}

function username(id) {
  return users.get(id) || "Kullanıcı";
}

function sendOnlineUsers() {
  const list = Array.from(users.values());
  io.emit("users:update", list);
}

function addChatMessage(name, text) {
  const message = {
    username: name,
    text,
    time: Date.now()
  };

  chatHistory.push(message);

  if (chatHistory.length > MAX_HISTORY) {
    chatHistory.shift();
  }

  io.emit("chat:message", message);
}

// GIF API
app.get("/api/gifs", async (req, res) => {
  try {
    if (!GIPHY_API_KEY) {
      return res.status(500).json({
        error: "GIPHY_API_KEY ayarlanmamış."
      });
    }

    const q = cleanText(req.query.q);
    const offset = Math.max(
      0,
      Math.min(9999, Number(req.query.offset) || 0)
    );

    if (!q) return res.json({ gifs: [] });

    const url = new URL("https://api.giphy.com/v1/gifs/search");

    url.searchParams.set("api_key", GIPHY_API_KEY);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "50");
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("rating", "pg");

    const response = await fetch(url);

    if (!response.ok) {
      return res.status(502).json({
        error: "GIF servisi yanıt vermedi."
      });
    }

    const result = await response.json();

    const gifs = (result.data || []).map(gif => ({
      id: gif.id,
      url: gif.images?.fixed_height?.url || "",
      preview: gif.images?.fixed_height_small?.url || ""
    })).filter(gif => gif.url);

    res.json({ gifs });
  } catch (error) {
    console.error("GIF error:", error);
    res.status(500).json({ error: "GIF arama hatası." });
  }
});

function getRoom(name) {
  return voiceRooms.get(roomKey(name));
}

function sendRoomUsers(room) {
  const list = Array.from(room.members).map(id => ({
    id,
    username: username(id),
    isHost: id === room.hostId
  }));

  io.to(room.key).emit("voice:users", list);
}

function sendHostStatus(socket, room) {
  socket.emit("voice:host-status", {
    roomName: room.name,
    isHost: room.hostId === socket.id
  });
}

function closeRoom(room) {
  if (!room) return;

  io.to(room.key).emit("voice:room-closed", {
    roomName: room.name
  });

  for (const id of room.members) {
    const member = io.sockets.sockets.get(id);

    if (member) {
      member.leave(room.key);
      member.data.voiceRoom = "";
      member.data.voiceRoomKey = "";
    }
  }

  voiceRooms.delete(room.key);
}

function leaveRoom(socket) {
  const key = socket.data.voiceRoomKey;
  const name = socket.data.voiceRoom;

  if (!key || !name) return;

  const room = voiceRooms.get(key);

  socket.data.voiceRoom = "";
  socket.data.voiceRoomKey = "";
  socket.leave(key);

  if (!room) return;

  if (room.hostId === socket.id) {
    closeRoom(room);
    return;
  }

  room.members.delete(socket.id);

  socket.to(key).emit("voice:peer-left", {
    id: socket.id,
    username: username(socket.id)
  });

  sendRoomUsers(room);
}

io.on("connection", socket => {
  console.log("Bağlandı:", socket.id);

  socket.on("user:join", value => {
    const name = cleanName(
      typeof value === "string" ? value : value?.username
    );

    if (!name) return;

    users.set(socket.id, name);
    socket.data.username = name;

    socket.emit("chat:history", chatHistory);
    sendOnlineUsers();
  });

  socket.on("chat:message", value => {
    if (!users.has(socket.id)) return;

    const text = cleanText(value);
    if (!text) return;

    addChatMessage(username(socket.id), text);
  });

  // ODA OLUŞTUR
  socket.on("voice:create", (value, callback) => {
    if (!users.has(socket.id)) {
      if (callback) callback({ ok: false, error: "Önce kayıt ol." });
      return;
    }

    const name = cleanRoomName(
      typeof value === "string" ? value : value?.roomName
    ) || `${username(socket.id)} Odası`;

    const key = roomKey(name);

    if (voiceRooms.has(key)) {
      if (callback) callback({ ok: false, error: "Bu oda zaten var." });
      return;
    }

    leaveRoom(socket);

    const room = {
      key,
      name,
      hostId: socket.id,
      members: new Set([socket.id]),
      videoId: ""
    };

    voiceRooms.set(key, room);

    socket.join(key);
    socket.data.voiceRoom = name;
    socket.data.voiceRoomKey = key;

    sendHostStatus(socket, room);
    sendRoomUsers(room);

    socket.emit("voice:room-joined", {
      roomName: name,
      hostId: socket.id,
      isHost: true,
      peers: []
    });

    if (callback) {
      callback({
        ok: true,
        roomName: name,
        hostId: socket.id,
        peers: []
      });
    }
  });

  // ODAYA KATIL
  socket.on("voice:join", (value, callback) => {
    const name = cleanRoomName(
      typeof value === "string" ? value : value?.roomName
    );

    const room = getRoom(name);

    if (!room) {
      if (callback) callback({ ok: false, error: "Oda bulunamadı." });
      return;
    }

    leaveRoom(socket);

    const peers = Array.from(room.members).map(id => ({
      id,
      username: username(id)
    }));

    room.members.add(socket.id);

    socket.join(room.key);
    socket.data.voiceRoom = room.name;
    socket.data.voiceRoomKey = room.key;

    sendHostStatus(socket, room);

    socket.emit("voice:room-joined", {
      roomName: room.name,
      hostId: room.hostId,
      isHost: false,
      peers
    });

    if (room.videoId) {
      socket.emit("youtube:play", {
        videoId: room.videoId
      });
    }

    socket.to(room.key).emit("voice:peer-joined", {
      id: socket.id,
      username: username(socket.id)
    });

    sendRoomUsers(room);

    if (callback) {
      callback({
        ok: true,
        roomName: room.name,
        hostId: room.hostId,
        peers
      });
    }
  });

  // WEBRTC SİNYALİ
  socket.on("voice:signal", packet => {
    const room = getRoom(socket.data.voiceRoom);

    if (!room || !packet || !packet.to) return;
    if (!room.members.has(packet.to)) return;

    io.to(packet.to).emit("voice:signal", {
      from: socket.id,
      data: packet.data
    });
  });

  // ODA MESAJI
  socket.on("voice:message", value => {
    const room = getRoom(socket.data.voiceRoom);
    if (!room) return;

    const text = cleanText(
      typeof value === "string" ? value : value?.text
    );

    if (!text) return;

    io.to(room.key).emit("voice:message", {
      username: username(socket.id),
      text,
      time: Date.now()
    });
  });

  // YOUTUBE OYNAT
  socket.on("youtube:play", value => {
    const room = getRoom(socket.data.voiceRoom);
    if (!room || room.hostId !== socket.id) return;

    const videoId = cleanText(value?.videoId);

    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return;

    room.videoId = videoId;

    io.to(room.key).emit("youtube:play", { videoId });
  });

  // YOUTUBE KAPAT
  socket.on("youtube:close", () => {
    const room = getRoom(socket.data.voiceRoom);
    if (!room || room.hostId !== socket.id) return;

    room.videoId = "";
    io.to(room.key).emit("youtube:close");
  });

  socket.on("voice:leave", () => leaveRoom(socket));

  socket.on("voice:close", () => {
    const room = getRoom(socket.data.voiceRoom);

    if (room && room.hostId === socket.id) {
      closeRoom(room);
    } else {
      leaveRoom(socket);
    }
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
    users.delete(socket.id);
    sendOnlineUsers();

    console.log("Ayrıldı:", socket.id);
  });
});

server.listen(PORT, () => {
  console.log("Chatbox çalışıyor, port:", PORT);
});
