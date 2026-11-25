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

  // Oda simgesine basınca menüyü aç
  $("roomIcon").addEventListener("click", () => {
    $("roomDropdown").classList.toggle("hidden");
  });

  // Oda oluştur penceresini aç
  $("createRoomButton").addEventListener("click", () => {
    $("roomDropdown").classList.add("hidden");
    $("roomModal").classList.remove("hidden");
    $("newRoomName").value = "";
    $("newRoomName").focus();
  });

  $("cancelRoomButton").addEventListener("click", () => {
    $("roomModal").classList.add("hidden");
  });

  // Yeni odaya katıl
  $("confirmRoomButton").addEventListener("click", () => {
    const newRoom = $("newRoomName").value.trim();

    if (!newRoom) {
      alert("Oda adı yaz.");
      return;
    }

    if (!username) {
      alert("Önce sohbete giriş yap.");
      return;
    }

    socket.emit("joinRoom", {
      username,
      room: newRoom
    });

    $("roomModal").classList.add("hidden");
  });

  $("newRoomName").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      $("confirmRoomButton").click();
    }
  });

  // Odaya giriş başarılı
  socket.on("joined", data => {
    username = data.username;
    room = data.room;

    $("roomTitle").textContent = room;
    $("loginScreen").classList.add("hidden");
    $("chatScreen").classList.remove("hidden");
    $("messages").replaceChildren();
  });

  // Odadan çık
  $("leaveButton")?.addEventListener("click", () => {
    location.reload();
  });

  // Mesaj gönder
  $("messageForm").addEventListener("submit", event => {
    event.preventDefault();

    const input = $("messageInput");
    const text = input.value.trim();

    if (!text) return;

    socket.emit("chatMessage", {
      type: "text",
      text
    });

    input.value = "";
  });

  // Mesajları göster
  socket.on("chatMessage", data => {
    const message = document.createElement("div");
    message.className = "message";

    const name = document.createElement("strong");
    name.textContent = data.username;

    const time = document.createElement("small");
    time.textContent = data.time || "";

    message.append(name, time);

    if (data.type === "gif" && data.url) {
      const img = document.createElement("img");
      img.src = data.url;
      img.alt = "GIF";
      img.className = "chatGif";
      img.loading = "lazy";
      message.appendChild(img);
    } else {
      const text = document.createElement("p");
      text.textContent = data.text;
      message.appendChild(text);
    }

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

  // GIF panelini aç/kapat
  $("gifButton").addEventListener("click", () => {
    $("gifPanel").classList.toggle("hidden");

    if (!$("gifPanel").classList.contains("hidden")) {
      $("gifSearch").focus();
    }
  });

  // GIF arama
  let gifSearchTimeout;

  $("gifSearch").addEventListener("input", () => {
    clearTimeout(gifSearchTimeout);

    gifSearchTimeout = setTimeout(searchGifs, 400);
  });

  async function searchGifs() {
    const query = $("gifSearch").value.trim();
    const results = $("gifResults");

    results.replaceChildren();

    if (!query) return;

    try {
      const response = await fetch(
        `/api/gifs?q=${encodeURIComponent(query)}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "GIF araması başarısız.");
      }

      data.results.forEach(gif => {
        const button = document.createElement("button");
        button.className = "gifResult";

        const img = document.createElement("img");
        img.src = gif.url;
        img.alt = "GIF";
        img.loading = "lazy";

        button.appendChild(img);

        button.addEventListener("click", () => {
          socket.emit("chatMessage", {
            type: "gif",
            url: gif.url
          });

          $("gifPanel").classList.add("hidden");
        });

        results.appendChild(button);
      });
    } catch (error) {
      const message = document.createElement("p");
      message.textContent = error.message;
      results.appendChild(message);
    }
  }
})();
