
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

// room => { owner, users: Map(socketId, username) }
const rooms = new Map();

app.use(express.static("public"));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

function clean(value, max = 80) {
  return String(value ?? "")
    .trim()
    .replace(/[<>]/g, "")
    .slice(0, max);
}

function roomUsers(room) {
  const data = rooms.get(room);

  return data
    ? [...data.users].map(([id, username]) => ({
        id,
        username
      }))
    : [];
}

function emitRoomState(room) {
  const data = rooms.get(room);
  if (!data) return;

  io.to(room).emit("roomState", {
    room,
    ownerId: data.owner,
    users: roomUsers(room)
  });
}

function leaveCurrent(socket) {
  const room = socket.data.room;
  if (!room) return;

  const data = rooms.get(room);

  socket.leave(room);
  socket.data.room = null;

  if (!data) return;

  data.users.delete(socket.id);

  io.to(room).emit("systemMessage", {
    text: `${socket.data.username} odadan ayrıldı.`
  });

  // Oda sahibi ayrılırsa yeni oda sahibi seç
  if (data.owner === socket.id) {
    const next = data.users.keys().next();

    if (!next.done) {
      data.owner = next.value;
    }
  }

  if (data.users.size === 0) {
    rooms.delete(room);
  } else {
    emitRoomState(room);
  }
}

io.on("connection", socket => {
  socket.data.username = "Misafir";
  socket.data.room = null;

  // Odaya katılma veya oda oluşturma
  socket.on("joinRoom", payload => {
    const username =
      clean(payload?.username, 24) || "Misafir";

    const room = clean(payload?.room, 32)
      .replace(/\s+/g, "-");

    if (!room) {
      return socket.emit(
        "errorMessage",
        "Oda adı gerekli."
      );
    }

    leaveCurrent(socket);

    socket.data.username = username;
    socket.data.room = room;

    let data = rooms.get(room);

    // Oda yoksa oluşturan kişi oda sahibi olur
    if (!data) {
      data = {
        owner: socket.id,
        users: new Map()
      };

      rooms.set(room, data);
    }

    data.users.set(socket.id, username);
    socket.join(room);

    socket.emit("joined", {
      room,
      ownerId: data.owner,
      users: roomUsers(room)
    });

    socket.to(room).emit("systemMessage", {
      text: `${username} odaya katıldı.`
    });

    emitRoomState(room);
  });

  // Mesaj gönderme
  socket.on("chatMessage", payload => {
    const room = socket.data.room;
    if (!room) return;

    const text = clean(payload?.text, 1500);
    if (!text) return;

    io.to(room).emit("chatMessage", {
      username: socket.data.username,
      text,
      time: Date.now()
    });
  });

  // Giphy GIF arama
  socket.on("gifSearch", async query => {
    const q = clean(query, 80);
    const key = process.env.GIPHY_API_KEY;

    if (!key) {
      return socket.emit("gifResults", {
        query: q,
        gifs: [],
        error: "Sunucuda GIPHY_API_KEY ayarlanmamış."
      });
    }

    try {
      const url = new URL(
        "https://api.giphy.com/v1/gifs/search"
      );

      url.search = new URLSearchParams({
        api_key: key,
        q,
        limit: "24",
        rating: "g",
        lang: "tr"
      });

      const response = await fetch(url);

      if (!response.ok) {
        throw new Error("Giphy API yanıt vermedi.");
      }

      const result = await response.json();

      const gifs = (result.data || [])
        .map(g => ({
          url:
            g.images?.fixed_height?.url ||
            g.images?.downsized_medium?.url,

          preview:
            g.images?.fixed_height_small?.url ||
            g.images?.fixed_height?.url,

          title: clean(g.title, 100)
        }))
        .filter(g => g.url);

      socket.emit("gifResults", {
        query: q,
        gifs
      });
    } catch (err) {
      socket.emit("gifResults", {
        query: q,
        gifs: [],
        error: "GIF araması başarısız oldu."
      });
    }
  });

  // GIF gönderme
  socket.on("sendGif", payload => {
    const room = socket.data.room;
    const url = String(payload?.url || "");

    if (
      !room ||
      !/^https:\/\/media\d?\.giphy\.com\//i.test(url)
    ) {
      return;
    }

    io.to(room).emit("gifMessage", {
      username: socket.data.username,
      url,
      time: Date.now()
    });
  });

  // YouTube videosunu oda sahibi paylaşabilir
  socket.on("youtubeShare", payload => {
    const room = socket.data.room;
    const data = rooms.get(room);

    const videoId = String(
      payload?.videoId || ""
    );

    if (
      !room ||
      !data ||
      data.owner !== socket.id ||
      !/^[\w-]{11}$/.test(videoId)
    ) {
      return;
    }

    // Yalnızca bu odadaki kişilere gönder
    io.to(room).emit("youtubeOpen", {
      videoId,
      username: socket.data.username
    });
  });

  // YouTube videosunu yalnızca oda sahibi kapatabilir
  socket.on("youtubeClose", () => {
    const room = socket.data.room;
    const data = rooms.get(room);

    if (
      room &&
      data &&
      data.owner === socket.id
    ) {
      io.to(room).emit("youtubeClose");
    }
  });

  // WebRTC sesli sohbet sinyalleşmesi
  // Ses verisi bu sunucudan geçmez.
  socket.on("voiceJoin", () => {
    const room = socket.data.room;
    if (!room) return;

    socket.to(room).emit("voicePeerJoined", {
      id: socket.id,
      username: socket.data.username
    });

    socket.emit(
      "voicePeers",
      roomUsers(room).filter(
        user => user.id !== socket.id
      )
    );
  });

  socket.on("voiceSignal", payload => {
    const room = socket.data.room;

    if (
      !room ||
      !payload ||
      typeof payload.to !== "string"
    ) {
      return;
    }

    const data = rooms.get(room);

    if (
      !data ||
      !data.users.has(payload.to)
    ) {
      return;
    }

    io.to(payload.to).emit("voiceSignal", {
      from: socket.id,
      signal: payload.signal
    });
  });

  socket.on("voiceLeave", () => {
    const room = socket.data.room;

    if (room) {
      socket.to(room).emit("voicePeerLeft", {
        id: socket.id
      });
    }
  });

  socket.on("leaveRoom", () => {
    leaveCurrent(socket);
  });

  socket.on("disconnect", () => {
    leaveCurrent(socket);
  });
});

server.listen(PORT, () => {
  console.log(`Chatbox listening on ${PORT}`);
});
