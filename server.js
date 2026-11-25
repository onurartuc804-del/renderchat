"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = new Map();

function getRoomUsers(room) {
  const members = rooms.get(room);

  if (!members) return [];

  return Array.from(members)
    .map(id => io.sockets.sockets.get(id))
    .filter(Boolean)
    .map(user => user.data.username);
}

function sendUserList(room) {
  io.to(room).emit("userList", {
    users: getRoomUsers(room)
  });
}

function leaveCurrentRoom(socket) {
  const oldRoom = socket.data.room;
  const username = socket.data.username;

  if (!oldRoom) return;

  const members = rooms.get(oldRoom);

  if (members) {
    members.delete(socket.id);

    if (members.size === 0) {
      rooms.delete(oldRoom);
    }
  }

  socket.leave(oldRoom);

  socket.to(oldRoom).emit("systemMessage", {
    text: `${username} odadan ayrıldı`
  });

  sendUserList(oldRoom);

  socket.data.room = null;
}

io.on("connection", socket => {
  socket.on("joinRoom", data => {
    let username = String(data?.username || "").trim().slice(0, 24);
    let room = String(data?.room || "").trim().slice(0, 30);

    if (!username || !room) return;

    // Aynı kullanıcı başka odaya geçerse eski odadan çıkar
    if (socket.data.room) {
      leaveCurrentRoom(socket);
    }

    socket.data.username = username;
    socket.data.room = room;

    socket.join(room);

    if (!rooms.has(room)) {
      rooms.set(room, new Set());
    }

    rooms.get(room).add(socket.id);

    socket.emit("joined", {
      username,
      room
    });

    socket.to(room).emit("systemMessage", {
      text: `${username} odaya katıldı`
    });

    sendUserList(room);
  });

  socket.on("chatMessage", data => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (!room || !username || !data) return;

    const time = new Date().toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    if (data.type === "gif") {
      const url = String(data.url || "");

      // Yalnızca HTTPS GIF adreslerini kabul et
      if (!url.startsWith("https://")) return;

      io.to(room).emit("chatMessage", {
        type: "gif",
        username,
        url,
        time
      });

      return;
    }

    const text = String(data.text || "").trim().slice(0, 2000);

    if (!text) return;

    io.to(room).emit("chatMessage", {
      type: "text",
      username,
      text,
      time
    });
  });

  socket.on("disconnect", () => {
    leaveCurrentRoom(socket);
  });
});

// Tenor GIF arama API'si
app.get("/api/gifs", async (req, res) => {
  const apiKey = process.env.TENOR_API_KEY;
  const query = String(req.query.q || "").trim().slice(0, 100);

  if (!apiKey) {
    return res.status(503).json({
      error: "Tenor API anahtarı Render ayarlarına eklenmemiş."
    });
  }

  if (!query) {
    return res.json({ results: [] });
  }

  try {
    const url = new URL("https://tenor.googleapis.com/v2/search");

    url.searchParams.set("q", query);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("limit", "18");
    url.searchParams.set("media_filter", "gif");
    url.searchParams.set("contentfilter", "medium");

    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: "GIF servisi şu anda yanıt vermiyor."
      });
    }

    const results = (data.results || [])
      .map(item => ({
        url: item.media_formats?.gif?.url
      }))
      .filter(item => item.url && item.url.startsWith("https://"));

    res.json({ results });
  } catch (error) {
    console.error("GIF arama hatası:", error);

    res.status(500).json({
      error: "GIF araması yapılamadı."
    });
  }
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chatbox çalışıyor: ${PORT}`);
});
