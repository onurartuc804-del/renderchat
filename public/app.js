
"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const socket = io();

  let username = "";
  let room = "";

  $("joinButton").addEventListener("click", () => {
    username = $("username").value.trim();
    room = $("room").value.trim();

    if (!username || !room) {
      alert("Kullanıcı adı ve oda adı gir.");
      return;
    }

    socket.emit("joinRoom", { username, room });
  });

  socket.on("joined", data => {
    username = data.username;
    room = data.room;

    $("roomTitle").textContent = room;
    $("loginScreen").classList.add("hidden");
    $("chatScreen").classList.remove("hidden");
    $("messages").replaceChildren();
  });

  $("leaveButton").addEventListener("click", () => {
    location.reload();
  });

  $("messageForm").addEventListener("submit", event => {
    event.preventDefault();

    const input = $("messageInput");
    const text = input.value.trim();

    if (!text) return;

    socket.emit("chatMessage", text);
    input.value = "";
  });

  socket.on("chatMessage", data => {
    const message = document.createElement("div");
    message.className = "message";

    const name = document.createElement("strong");
    name.textContent = data.username;

    const time = document.createElement("small");
    time.textContent = data.time;

    const text = document.createElement("p");
    text.textContent = data.text;

    message.append(name, time, text);
    $("messages").appendChild(message);
    $("messages").scrollTop = $("messages").scrollHeight;
  });

  socket.on("systemMessage", data => {
    const message = document.createElement("div");
    message.className = "systemMessage";
    message.textContent = data.text;

    $("messages").appendChild(message);
    $("messages").scrollTop = $("messages").scrollHeight;
  });

  socket.on("userList", data => {
    $("userList").replaceChildren();

    data.users.forEach(name => {
      const item = document.createElement("li");
      item.textContent = name;
      $("userList").appendChild(item);
    });
  });
})();
