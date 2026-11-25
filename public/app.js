
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  // --------------------------------
  // SOCKET.IO
  // --------------------------------

  const socket = io();
  window.chatboxSocket = socket;

  let username = localStorage.getItem("chatbox_username") || "";
  window.chatboxUsername = username;

  // --------------------------------
  // HTML ELEMANLARI
  // --------------------------------

  const loginScreen = $("loginScreen");
  const chatScreen = $("chatScreen");
  const voiceScreen = $("voiceScreen");

  const usernameInput = $("usernameInput");
  const joinButton = $("joinButton");

  const messages = $("messages");
  const messageInput = $("messageInput");
  const sendButton = $("sendButton");

  const gifSearchInput = $("gifSearchInput");
  const gifSearchButton = $("gifSearchButton");
  const gifResults = $("gifResults");

  // --------------------------------
  // SES
  // --------------------------------

  function playSound(path) {
    try {
      const audio = new Audio(path);
      audio.volume = 0.5;
      audio.play().catch(() => {});
    } catch (error) {
      console.warn("Ses çalınamadı:", error);
    }
  }

  // --------------------------------
  // EKRAN DEĞİŞTİRME
  // --------------------------------

  function showChat() {
    loginScreen?.classList.add("hidden");
    chatScreen?.classList.remove("hidden");
    voiceScreen?.classList.remove("hidden");
  }

  function showJoin() {
    loginScreen?.classList.remove("hidden");
    chatScreen?.classList.add("hidden");
    voiceScreen?.classList.add("hidden");
  }

  // --------------------------------
  // KULLANICI GİRİŞİ
  // --------------------------------

  function joinChat() {
    const name = String(usernameInput?.value || "").trim();

    if (!name) {
      alert("Bir kullanıcı adı yaz.");
      return;
    }

    if (name.length > 24) {
      alert("Kullanıcı adı en fazla 24 karakter olabilir.");
      return;
    }

    username = name;
    window.chatboxUsername = username;

    localStorage.setItem("chatbox_username", username);

    showChat();

    if (socket.connected) {
      socket.emit("user:join", username);
    } else {
      socket.connect();
    }
  }

  joinButton?.addEventListener("click", joinChat);

  usernameInput.value = username;

  usernameInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      joinChat();
    }
  });

  socket.on("connect", () => {
    console.log("Chatbox sunucuya bağlandı.");

    if (username) {
      socket.emit("user:join", username);
    }
  });

  socket.on("disconnect", () => {
    console.log("Chatbox bağlantısı kesildi.");
  });

  // --------------------------------
  // MESAJ GÖSTERME
  // --------------------------------

  function addMessage(data, own = false) {
    if (!messages || !data) return;

    const item = document.createElement("div");
    item.className = own
      ? "message own-message"
      : "message";

    const header = document.createElement("div");
    header.className = "message-header";

    const name = document.createElement("strong");
    name.textContent = data.username || "Kullanıcı";

    const time = document.createElement("small");

    time.textContent = new Date(
      data.time || Date.now()
    ).toLocaleTimeString("tr-TR", {
      hour: "2-digit",
      minute: "2-digit"
    });

    header.append(name, time);

    const text = String(data.text || "");

    // GIF URL kontrolü
    if (/^https?:\/\/.+\.gif(\?.*)?$/i.test(text)) {
      const image = document.createElement("img");

      image.src = text;
      image.alt = "GIF";
      image.className = "chat-gif";
      image.style.maxWidth = "100%";
      image.style.maxHeight = "250px";
      image.style.borderRadius = "8px";
      image.loading = "lazy";

      item.append(header, image);
    } else {
      const content = document.createElement("div");

      content.className = "message-content";
      content.textContent = text;

      item.append(header, content);
    }

    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  // --------------------------------
  // MESAJ GEÇMİŞİ
  // --------------------------------

  socket.on("chat:history", history => {
    if (!messages) return;

    messages.innerHTML = "";

    (Array.isArray(history) ? history : []).forEach(message => {
      addMessage(
        message,
        message.username === username
      );
    });
  });

  // --------------------------------
  // YENİ MESAJ
  // --------------------------------

  socket.on("chat:message", data => {
    if (!data) return;

    addMessage(data, data.username === username);

    if (data.username !== username) {
      playSound("sounds/message.mp3");
    }
  });

  // --------------------------------
  // MESAJ GÖNDER
  // --------------------------------

  function sendMessage() {
    const text = String(messageInput?.value || "").trim();

    if (!text) return;

    if (!socket.connected) {
      alert("Sunucuya bağlı değilsin.");
      return;
    }

    socket.emit("chat:message", text);

    messageInput.value = "";
    messageInput.focus();
  }

  sendButton?.addEventListener("click", sendMessage);

  messageInput?.addEventListener("keydown", event => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  });

  // --------------------------------
  // ÇEVRİMİÇİ KULLANICILAR
  // --------------------------------

  socket.on("users:update", users => {
    const onlineUsers = $("onlineUsers");
    const onlineCount = $("onlineCount");

    if (!onlineUsers) return;

    onlineUsers.innerHTML = "";

    const list = Array.isArray(users) ? users : [];

    if (onlineCount) {
      onlineCount.textContent = list.length;
    }

    list.forEach(name => {
      const user = document.createElement("div");
      user.className = "online-user";

      const dot = document.createElement("span");
      dot.className = "online-dot";

      const label = document.createElement("span");
      label.textContent = name;

      user.append(dot, label);
      onlineUsers.appendChild(user);
    });
  });

  // --------------------------------
  // GIF ARAMA
  // --------------------------------

  let gifQuery = "";
  let gifOffset = 0;
  let gifTotal = 0;
  let gifLoading = false;
  let gifHasMore = false;

  const GIF_LIMIT = 50;
  const GIF_MAX = 10000;

  async function searchGifs(reset = true) {
    if (gifLoading) return;

    if (reset) {
      gifQuery = String(gifSearchInput?.value || "").trim();

      if (!gifQuery) {
        gifQuery = "funny";
      }

      gifOffset = 0;
      gifTotal = 0;
      gifHasMore = false;

      if (gifResults) {
        gifResults.innerHTML = "";
      }
    }

    if (gifOffset >= GIF_MAX) return;

    gifLoading = true;

    try {
      const params = new URLSearchParams({
        q: gifQuery,
        limit: String(GIF_LIMIT),
        offset: String(gifOffset)
      });

      const response = await fetch(
        "/api/gifs?" + params.toString()
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.error || "GIF araması başarısız."
        );
      }

      const list = Array.isArray(result.gifs)
        ? result.gifs
        : [];

      list.forEach(gif => {
        if (!gifResults || !gif.url) return;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "gif-result";

        const image = document.createElement("img");
        image.src = gif.preview || gif.url;
        image.alt = gif.title || "GIF";
        image.loading = "lazy";

        button.appendChild(image);

        button.addEventListener("click", () => {
          sendGif(gif.url);
        });

        gifResults.appendChild(button);
      });

      gifTotal = Math.min(
        GIF_MAX,
        Number(result.total) || 0
      );

      gifOffset = Number(result.nextOffset) ||
        gifOffset + list.length;

      gifHasMore =
        Boolean(result.hasMore) &&
        gifOffset < GIF_MAX &&
        gifOffset < gifTotal;

    } catch (error) {
      console.error("GIF arama hatası:", error);

      if (gifResults) {
        const message = document.createElement("p");
        message.textContent = error.message;
        gifResults.appendChild(message);
      }
    } finally {
      gifLoading = false;
    }
  }

  // --------------------------------
  // GIF GÖNDER
  // --------------------------------

  function sendGif(url) {
    if (!socket.connected) {
      alert("Sunucuya bağlı değilsin.");
      return;
    }

    socket.emit("chat:message", url);
  }

  gifSearchButton?.addEventListener("click", () => {
    searchGifs(true);
  });

  gifSearchInput?.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      searchGifs(true);
    }
  });

  // --------------------------------
  // BAŞLANGIÇ
  // --------------------------------

  if (username) {
    usernameInput.value = username;
    showChat();

    if (socket.connected) {
      socket.emit("user:join", username);
    }
  } else {
    showJoin();
  }

  console.log("Chatbox app.js yüklendi.");

})();
