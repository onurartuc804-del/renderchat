(() => {
  "use strict";

  const $ = id => document.getElementById(id);

  // HTML elemanları
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
  const onlineCount = $("onlineCount");
  const memberCount = $("memberCount");

  let socket = null;
  let username = "";
  let joined = false;

  let gifOffset = 0;
  let gifTotal = 0;
  let gifQueryText = "";
  let gifLoading = false;
  let gifRequestNumber = 0;

  // Bildirim
  function showToast(text) {
    const toast = $("toast");
    if (!toast) return;

    toast.textContent = text;
    toast.classList.add("show");

    clearTimeout(showToast.timer);

    showToast.timer = setTimeout(() => {
      toast.classList.remove("show");
    }, 2800);
  }

  // Ekran geçişleri
  function showJoin() {
    joinScreen.classList.remove("hidden");
    chatScreen.classList.add("hidden");
    chatScreen.setAttribute("aria-hidden", "true");
  }

  function showChat() {
    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    chatScreen.setAttribute("aria-hidden", "false");
  }

  // Saat formatı
  function formatTime(time) {
    return new Date(time || Date.now()).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  // Sistem mesajı
  function addSystem(message) {
    const item = document.createElement("div");
    item.className = "system-message";
    item.textContent = message.text || "";

    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  // Sohbet mesajı
  function addMessage(message) {
    const row = document.createElement("article");
    row.className = "message";

    // Avatar
    const avatar = document.createElement("div");
    avatar.className = "message-avatar";
    avatar.textContent =
      (message.username || "?").charAt(0).toUpperCase();

    // Mesaj gövdesi
    const body = document.createElement("div");
    body.className = "message-body";

    // İsim ve saat
    const meta = document.createElement("div");
    meta.className = "message-meta";

    const name = document.createElement("strong");
    name.textContent = message.username || "Guest";

    const time = document.createElement("time");
    time.textContent = formatTime(message.time);

    meta.append(name, time);
    body.appendChild(meta);

    // GIF veya metin
    if (message.type === "gif") {
      const image = document.createElement("img");

      image.className = "message-gif";
      image.src = message.url;
      image.alt = message.title || "GIF";
      image.loading = "lazy";

      image.onerror = () => {
        image.alt = "GIF yüklenemedi";
      };

      body.appendChild(image);
    } else {
      const text = document.createElement("div");

      text.className = "message-text";
      text.textContent = message.text || "";

      body.appendChild(text);
    }

    row.append(avatar, body);
    messages.appendChild(row);

    messages.scrollTop = messages.scrollHeight;
  }

  // Kullanıcı listesi
  function renderUsers(users) {
    if (onlineCount) {
      onlineCount.textContent = users.length;
    }

    if (memberCount) {
      memberCount.textContent = users.length;
    }

    userList.replaceChildren();

    users.forEach(user => {
      const item = document.createElement("div");
      item.className = "member";

      const avatar = document.createElement("div");
      avatar.className = "member-avatar";
      avatar.textContent =
        (user.username || "?").charAt(0).toUpperCase();

      const name = document.createElement("span");
      name.className = "member-name";
      name.textContent = user.username || "Guest";

      const dot = document.createElement("span");
      dot.className = "live-dot";

      item.append(avatar, name, dot);
      userList.appendChild(item);
    });
  }

  // Socket bağlantısı
  function connectChat() {
    if (socket) return;

    if (typeof io !== "function") {
      showToast("Socket.IO yüklenemedi. Sayfayı yenile.");
      return;
    }

    socket = io();

    socket.on("connect", () => {
      socket.emit("join", username);
    });

    socket.on("connect_error", () => {
      showToast("Sohbet sunucusuna bağlanılamadı.");
    });

    socket.on("chat:history", history => {
      messages.replaceChildren();
      history.forEach(addMessage);
    });

    socket.on("chat:message", message => {
      addMessage(message);
    });

    socket.on("chat:system", message => {
      addSystem(message);
    });

    socket.on("users:update", users => {
      renderUsers(users);
    });
  }

  // Kullanıcı adını kaydet ve sohbete gir
  function enterChat(name) {
    if (joined) return;

    username = name.trim().slice(0, 24);

    if (!username) return;

    joined = true;

    // Tarayıcıya kaydet
    localStorage.setItem("chatbox_username", username);

    // Profil
    const profileName = $("profileName");
    const profileAvatar = $("profileAvatar");

    if (profileName) {
      profileName.textContent = username;
    }

    if (profileAvatar) {
      profileAvatar.textContent =
        username.charAt(0).toUpperCase();
    }

    // Giriş ekranını kapat, sohbeti aç
    showChat();

    // Sunucuya bağlan
    connectChat();

    messageInput.focus();
  }

  // Giriş formu — yalnızca bir tane
  joinForm.addEventListener("submit", event => {
    event.preventDefault();

    const name = nameInput.value.trim();

    if (!name) {
      nameInput.focus();
      return;
    }

    enterChat(name);
  });

  // Kayıtlı kullanıcı adını kontrol et
  const savedName = localStorage.getItem("chatbox_username");

  if (savedName && savedName.trim()) {
    nameInput.value = savedName;
    enterChat(savedName);
  } else {
    showJoin();
  }

  // Mesaj gönderme
  messageForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = messageInput.value.trim();

    if (!text) return;

    if (!socket || !socket.connected) {
      showToast("Sohbet bağlantısı bekleniyor.");
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
      showToast("Önce sohbet bağlantısı kurulsun.");
      return;
    }

    gifModal.classList.remove("hidden");
    gifModal.setAttribute("aria-hidden", "false");

    gifQuery.focus();

    // Trend GIF'leri getir
    loadGifs("", false);
  }

  // GIF penceresini kapat
  function hideGif() {
    gifModal.classList.add("hidden");
    gifModal.setAttribute("aria-hidden", "true");
  }

  gifButton.addEventListener("click", openGif);
  closeGif.addEventListener("click", hideGif);

  // Modal dışına basınca kapat
  gifModal.addEventListener("click", event => {
    if (event.target === gifModal) {
      hideGif();
    }
  });

  // ESC ile kapat
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      hideGif();
    }
  });

  // GIF sonuç mesajı
  function showGifMessage(text) {
    const item = document.createElement("div");
    item.className = "gif-message";
    item.textContent = text;
    gifResults.appendChild(item);
  }

  // Daha fazla GIF butonu
  function addLoadMoreButton() {
    const oldButton = $("loadMoreGifs");

    if (oldButton) {
      oldButton.remove();
    }

    const maxResults = Math.min(gifTotal, 5000);

    if (gifOffset >= maxResults) {
      return;
    }

    const button = document.createElement("button");

    button.id = "loadMoreGifs";
    button.type = "button";
    button.className = "load-more-gifs";
    button.textContent = "Daha fazla GIF yükle";

    button.addEventListener("click", () => {
      loadGifs(gifQueryText, true);
    });

    gifResults.appendChild(button);
  }

  // GIF gönder
  function sendGif(gif) {
    if (!socket || !socket.connected) {
      showToast("Sohbet bağlantısı yok.");
      return;
    }

    if (!gif || !gif.url) {
      showToast("GIF bağlantısı bulunamadı.");
      return;
    }

    socket.emit("chat:message", {
      type: "gif",
      url: gif.url,
      title: gif.title || "GIF"
    });

    hideGif();
  }

  // GIF sonuçlarını göster
  function renderGifs(gifs) {
    gifs.forEach(gif => {
      const button = document.createElement("button");

      button.type = "button";
      button.className = "gif-item";
      button.title = gif.title || "GIF gönder";

      const image = document.createElement("img");

      image.src = gif.preview;
      image.alt = gif.title || "GIF";
      image.loading = "lazy";

      button.appendChild(image);

      button.addEventListener("click", () => {
        sendGif(gif);
      });

      gifResults.appendChild(button);
    });
  }

  // GIF arama ve sayfalama
  async function loadGifs(query = "", append = false) {
    if (gifLoading) return;

    gifLoading = true;

    const requestNumber = ++gifRequestNumber;

    if (!append) {
      gifOffset = 0;
      gifTotal = 0;
      gifQueryText = query;

      gifResults.replaceChildren();
    }

    const oldMore = $("loadMoreGifs");

    if (oldMore) {
      oldMore.remove();
    }

    const loading = document.createElement("div");
    loading.className = "gif-message";
    loading.textContent = "GIF'ler yükleniyor...";

    gifResults.appendChild(loading);

    try {
      const url =
        `/api/gifs?q=${encodeURIComponent(gifQueryText)}` +
        `&offset=${gifOffset}`;

      const response = await fetch(url);
      const data = await response.json();

      // Eski arama isteği geldiyse yok say
      if (requestNumber !== gifRequestNumber) {
        return;
      }

      if (!response.ok) {
        throw new Error(data.error || "GIF arama başarısız.");
      }

      loading.remove();

      const gifs = Array.isArray(data.gifs) ? data.gifs : [];

      gifTotal = Number(data.total || 0);
      gifOffset = Number(data.nextOffset || gifOffset + 50);

      if (!gifs.length && !append) {
        showGifMessage("GIF bulunamadı.");
        return;
      }

      renderGifs(gifs);
      addLoadMoreButton();

    } catch (error) {
      if (requestNumber !== gifRequestNumber) {
        return;
      }

      loading.remove();

      showGifMessage(
        "GIF yüklenemedi. Render'daki GIPHY_API_KEY ayarını kontrol et."
      );

    } finally {
      if (requestNumber === gifRequestNumber) {
        gifLoading = false;
      }
    }
  }

  // GIF arama formu
  gifSearchForm.addEventListener("submit", event => {
    event.preventDefault();

    loadGifs(gifQuery.value.trim(), false);
  });

})();
