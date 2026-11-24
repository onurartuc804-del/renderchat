
(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  // --------------------------------
  // AYARLAR
  // --------------------------------

  const socket = io();

  window.chatboxSocket = socket;

  let username = localStorage.getItem("chatbox_username") || "";
  window.chatboxUsername = username;

  let gifQuery = "";
  let gifOffset = 0;
  let gifTotal = 10000;
  let gifLoading = false;
  let gifHasMore = false;

  const GIF_LIMIT = 50;
  const GIF_MAX = 10000;

  // --------------------------------
  // HTML ELEMANLARI
  // --------------------------------

  const joinScreen = $("joinScreen");
  const chatScreen = $("chatScreen");

  const usernameInput = $("usernameInput");
  const joinButton = $("joinButton");

  const messageInput = $("messageInput");
  const sendButton = $("sendButton");
  const messages = $("messages");

  const onlineUsers = $("onlineUsers");
  const onlineCount = $("onlineCount");

  const gifButton = $("gifButton");
  const gifModal = $("gifModal");
  const gifSearchInput = $("gifSearchInput");
  const gifSearchButton = $("gifSearchButton");
  const gifResults = $("gifResults");
  const loadMoreGifButton = $("loadMoreGifButton");
  const gifCloseButton = $("gifCloseButton");

  // --------------------------------
  // SESLER
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
    if (joinScreen) joinScreen.style.display = "none";
    if (chatScreen) chatScreen.style.display = "flex";
  }

  function showJoin() {
    if (joinScreen) joinScreen.style.display = "flex";
    if (chatScreen) chatScreen.style.display = "none";
  }

  // --------------------------------
  // KULLANICI GİRİŞİ
  // --------------------------------

  function joinChat() {
    const name = String(usernameInput?.value || username).trim();

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

    if (!socket.connected) {
      socket.connect();
    }

    if (socket.connected) {
      socket.emit("user:join", username);
    }

    showChat();
  }

  if (joinButton) {
    joinButton.addEventListener("click", joinChat);
  }

  if (usernameInput) {
    usernameInput.value = username;

    usernameInput.addEventListener("keydown", event => {
      if (event.key === "Enter") joinChat();
    });
  }

  socket.on("connect", () => {
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
    item.className = own ? "message own-message" : "message";

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

    const content = document.createElement("div");
    content.className = "message-content";
    content.textContent = data.text || "";

    header.append(name, time);
    item.append(header, content);

    messages.appendChild(item);

    messages.scrollTop = messages.scrollHeight;
  }

  // --------------------------------
  // MESAJ GEÇMİŞİ
  // --------------------------------

  socket.on("chat:history", history => {
    if (!messages) return;

    messages.innerHTML = "";

    (history || []).forEach(message => {
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

  if (sendButton) {
    sendButton.addEventListener("click", sendMessage);
  }

  if (messageInput) {
    messageInput.addEventListener("keydown", event => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
  }

  // --------------------------------
  // ÇEVRİMİÇİ KULLANICILAR
  // --------------------------------

  socket.on("users:update", users => {
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
  // GIF PENCERESİ
  // --------------------------------

  function openGifModal() {
    if (!gifModal) return;

    gifModal.style.display = "flex";

    if (gifSearchInput) {
      gifSearchInput.focus();
    }
  }

  function closeGifModal() {
    if (gifModal) {
      gifModal.style.display = "none";
    }
  }

  if (gifButton) {
    gifButton.addEventListener("click", openGifModal);
  }

  if (gifCloseButton) {
    gifCloseButton.addEventListener("click", closeGifModal);
  }

  // --------------------------------
  // GIF SONUÇLARI
  // --------------------------------

  function addGif(gif) {
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
      closeGifModal();
    });

    gifResults.appendChild(button);
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

  // --------------------------------
  // GIF ARAMA
  // --------------------------------

  async function searchGifs(reset = true) {
    if (gifLoading) return;

    if (reset) {
      gifQuery = String(gifSearchInput?.value || "").trim();

      if (!gifQuery) {
        gifQuery = "funny";
      }

      gifOffset = 0;
      gifTotal = GIF_MAX;
      gifHasMore = false;

      if (gifResults) {
        gifResults.innerHTML = "";
      }
    }

    if (gifOffset >= GIF_MAX) {
      gifHasMore = false;
      updateLoadMore();
      return;
    }

    gifLoading = true;
    updateLoadMore();

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
        throw new Error(result.error || "GIF araması başarısız.");
      }

      const list = Array.isArray(result.gifs)
        ? result.gifs
        : [];

      list.forEach(addGif);

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

      if (list.length === 0 && reset && gifResults) {
        const empty = document.createElement("p");
        empty.textContent = "GIF bulunamadı.";
        gifResults.appendChild(empty);
      }

    } catch (error) {
      console.error("GIF arama hatası:", error);

      if (gifResults) {
        const message = document.createElement("p");
        message.textContent = error.message;
        gifResults.appendChild(message);
      }

    } finally {
      gifLoading = false;
      updateLoadMore();
    }
  }

  // --------------------------------
  // DAHA FAZLA GIF
  // --------------------------------

  function updateLoadMore() {
    if (!loadMoreGifButton) return;

    loadMoreGifButton.disabled =
      gifLoading || !gifHasMore;

    loadMoreGifButton.textContent = gifLoading
      ? "Yükleniyor..."
      : gifHasMore
        ? "Daha fazla GIF yükle"
        : "Başka GIF yok";
  }

  if (gifSearchButton) {
    gifSearchButton.addEventListener("click", () => {
      searchGifs(true);
    });
  }

  if (gifSearchInput) {
    gifSearchInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        searchGifs(true);
      }
    });
  }

  if (loadMoreGifButton) {
    loadMoreGifButton.addEventListener("click", () => {
      if (gifHasMore) {
        searchGifs(false);
      }
    });
  }

  // --------------------------------
  // MESAJDA GIF URL'SİNİ GÖSTER
  // --------------------------------

  const originalAddMessage = addMessage;

  // Mesajları GIF olarak göstermek için ayrı kontrol
  socket.off("chat:message");

  socket.on("chat:message", data => {
    if (data.text && /^https?:\/\/.+\.(gif)(\?.*)?$/i.test(data.text)) {
      if (!messages) return;

      const item = document.createElement("div");
      item.className = data.username === username
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

      const image = document.createElement("img");
      image.src = data.text;
      image.alt = "GIF";
      image.className = "chat-gif";
      image.loading = "lazy";

      header.append(name, time);
      item.append(header, image);

      messages.appendChild(item);
      messages.scrollTop = messages.scrollHeight;

    } else {
      originalAddMessage(
        data,
        data.username === username
      );
    }

    if (data.username !== username) {
      playSound("sounds/message.mp3");
    }
  });

  // --------------------------------
  // BAŞLANGIÇ
  // --------------------------------

  if (username) {
    if (usernameInput) {
      usernameInput.value = username;
    }

    showChat();

    if (socket.connected) {
      socket.emit("user:join", username);
    }
  } else {
    showJoin();
  }

  console.log("Chatbox app.js yüklendi.");

})();
