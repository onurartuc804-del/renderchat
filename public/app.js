(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  const joinScreen = $("joinScreen");
  const chatScreen = $("chatScreen");
  const joinForm = $("joinForm");
  const nameInput = $("nameInput");

  const messageForm = $("messageForm");
  const messageInput = $("messageInput");
  const messages = $("messages");

  const gifButton = $("gifButton");
  const gifModal = $("gifModal");
  const closeGif = $("closeGif");
  const gifSearchForm = $("gifSearchForm");
  const gifQuery = $("gifQuery");
  const gifResults = $("gifResults");

  const userList = $("userList");
  const toast = $("toast");

  let socket = null;
  let username = "";
  let toastTimer = null;

  function showToast(text) {
    if (!toast) return;

    toast.textContent = text;
    toast.classList.add("show");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2600);
  }

  function showChat() {
    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    chatScreen.setAttribute("aria-hidden", "false");
  }

  function showJoin() {
    joinScreen.classList.remove("hidden");
    chatScreen.classList.add("hidden");
    chatScreen.setAttribute("aria-hidden", "true");
  }

  function timeLabel(time) {
    return new Date(time || Date.now()).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function makeAvatar(name) {
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent = (name || "?").slice(0, 1).toUpperCase();
    return avatar;
  }

  function addMessage(msg) {
    const row = document.createElement("article");
    row.className = "message";

    row.appendChild(makeAvatar(msg.username));

    const body = document.createElement("div");
    body.className = "message-body";

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const name = document.createElement("strong");
    name.textContent = msg.username || "Guest";

    const time = document.createElement("time");
    time.textContent = timeLabel(msg.time);

    meta.append(name, time);
    body.appendChild(meta);

    if (msg.type === "gif") {
      const img = document.createElement("img");
      img.className = "message-gif";
      img.src = msg.url;
      img.alt = msg.title || "GIF";
      img.loading = "lazy";
      body.appendChild(img);
    } else {
      const text = document.createElement("div");
      text.className = "message-text";
      text.textContent = msg.text || "";
      body.appendChild(text);
    }

    row.appendChild(body);
    messages.appendChild(row);

    messages.scrollTop = messages.scrollHeight;
  }

  function addSystem(msg) {
    const item = document.createElement("div");
    item.className = "system-message";
    item.textContent = msg.text || "";

    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  function renderUsers(users) {
    userList.replaceChildren();

    $("onlineCount").textContent = users.length;
    $("memberCount").textContent = users.length;

    users.forEach(user => {
      const item = document.createElement("div");
      item.className = "member";

      const avatar = document.createElement("div");
      avatar.className = "member-avatar";
      avatar.textContent = (user.username || "?").slice(0, 1).toUpperCase();

      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = user.username;

      const dot = document.createElement("span");
      dot.className = "live-dot";

      item.append(avatar, name, dot);
      userList.appendChild(item);
    });
  }

  // Kullanıcı adını kaydet ve sohbet ekranına geç
  joinForm.addEventListener("submit", event => {
    event.preventDefault();

    const name = nameInput.value.trim().slice(0, 24);

    if (!name) {
      nameInput.focus();
      return;
    }

    if (socket) return;

    username = name;

    // Kullanıcı adını cihazda kaydet
    localStorage.setItem("chatbox_username", username);

    $("profileName").textContent = username;
    $("profileAvatar").textContent =
      username.slice(0, 1).toUpperCase();

    // Giriş ekranını gizle, sohbeti aç
    showChat();

    if (typeof io !== "function") {
      showToast("Sohbet bağlantısı yüklenemedi.");
      return;
    }

    // Sunucuya bağlan
    socket = io();

    socket.on("connect", () => {
      socket.emit("join", username);
    });

    socket.on("connect_error", () => {
      showToast("Sunucuya bağlanılamadı. Tekrar dene.");
    });

    socket.on("chat:history", history => {
      messages.replaceChildren();
      history.forEach(addMessage);
    });

    socket.on("chat:message", addMessage);
    socket.on("chat:system", addSystem);
    socket.on("users:update", renderUsers);

    messageInput.focus();
  });

  // Sayfa açılınca kayıtlı adı kutuya yaz
  const savedName = localStorage.getItem("chatbox_username");

  if (savedName) {
    nameInput.value = savedName;
  }

  // Mesaj gönder
  messageForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = messageInput.value.trim();

    if (!text) return;

    if (!socket || !socket.connected) {
      showToast("Önce sohbete bağlan.");
      return;
    }

    socket.emit("chat:message", {
      type: "text",
      text
    });

    messageInput.value = "";
    messageInput.focus();
  });

  // GIF penceresini aç
  function openGif() {
    if (!socket || !socket.connected) {
      showToast("Önce sohbete bağlan.");
      return;
    }

    gifModal.classList.remove("hidden");
    gifModal.setAttribute("aria-hidden", "false");

    gifQuery.focus();
    loadGifs(gifQuery.value.trim());
  }

  // GIF penceresini kapat
  function closeGifModal() {
    gifModal.classList.add("hidden");
    gifModal.setAttribute("aria-hidden", "true");
  }

  gifButton.addEventListener("click", openGif);
  closeGif.addEventListener("click", closeGifModal);

  gifModal.addEventListener("click", event => {
    if (event.target === gifModal) {
      closeGifModal();
    }
  });

  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      closeGifModal();
    }
  });

  // GIF arama
  async function loadGifs(query) {
    gifResults.replaceChildren();

    const loading = document.createElement("div");
    loading.className = "gif-message";
    loading.textContent = "GIF'ler aranıyor...";
    gifResults.appendChild(loading);

    try {
      const response = await fetch(
        `/api/gifs?q=${encodeURIComponent(query || "")}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "GIF servisi yanıt vermedi.");
      }

      gifResults.replaceChildren();

      if (!data.gifs || !data.gifs.length) {
        const empty = document.createElement("div");
        empty.className = "gif-message";
        empty.textContent = "GIF bulunamadı.";
        gifResults.appendChild(empty);
        return;
      }

      data.gifs.forEach(gif => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "gif-item";
        button.title = gif.title || "GIF gönder";

        const img = document.createElement("img");
        img.src = gif.preview;
        img.alt = gif.title || "GIF";
        img.loading = "lazy";

        button.appendChild(img);

        button.addEventListener("click", () => {
          if (!socket || !socket.connected) {
            showToast("Sohbet bağlantısı yok.");
            return;
          }

          socket.emit("chat:message", {
            type: "gif",
            url: gif.url,
            title: gif.title
          });

          closeGifModal();
        });

        gifResults.appendChild(button);
      });
    } catch (error) {
      gifResults.replaceChildren();

      const errorBox = document.createElement("div");
      errorBox.className = "gif-message";

      errorBox.textContent = error.message.includes("GIPHY_API_KEY")
        ? "Render'da GIPHY_API_KEY ayarlanmalı."
        : "GIF yüklenemedi. API anahtarını kontrol et.";

      gifResults.appendChild(errorBox);
    }
  }

  gifSearchForm.addEventListener("submit", event => {
    event.preventDefault();
    loadGifs(gifQuery.value.trim());
  });

  // İlk açılışta yalnızca giriş ekranı
  showJoin();
})();
