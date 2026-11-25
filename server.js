
"use strict";

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

const rooms = new Map();

io.on("connection", socket => {
  socket.on("joinRoom", ({ username, room }) => {
    username = String(username || "Misafir").trim().slice(0, 24);
    room = String(room || "Genel").trim().slice(0, 30);

    if (!username || !room) return;

    socket.join(room);
    socket.data.username = username;
    socket.data.room = room;

    if (!rooms.has(room)) rooms.set(room, new Set());
    rooms.get(room).add(socket.id);

    socket.emit("joined", { username, room });

    socket.to(room).emit("systemMessage", {
      text: `${username} odaya katıldı`
    });

    io.to(room).emit("userList", {
      users: Array.from(rooms.get(room) || []).map(id => {
        const user = io.sockets.sockets.get(id);
        return user ? user.data.username : null;
      }).filter(Boolean)
    });
  });

  socket.on("chatMessage", text => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (!room || !username) return;

    text = String(text || "").trim().slice(0, 2000);
    if (!text) return;

    io.to(room).emit("chatMessage", {
      username,
      text,
      time: new Date().toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit"
      })
    });
  });

  socket.on("disconnect", () => {
    const room = socket.data.room;
    const username = socket.data.username;

    if (!room) return;

    const members = rooms.get(room);
    if (members) {
      members.delete(socket.id);

      if (members.size === 0) {
        rooms.delete(room);
      } else {
        io.to(room).emit("userList", {
          users: Array.from(members).map(id => {
            const user = io.sockets.sockets.get(id);
            return user ? user.data.username : null;
          }).filter(Boolean)
        });
      }
    }

    if (username) {
      socket.to(room).emit("systemMessage", {
        text: `${username} odadan ayrıldı`
      });
    }
  });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Chatbox çalışıyor: ${PORT}`);
});
