
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const socket = io();

  window.chatboxSocket = socket;

  let username = localStorage.getItem("chatbox_username") || "";
  window.chatboxUsername = username;

  const loginScreen = $("loginScreen");
  const mainScreen = $("mainScreen");
  const usernameInput = $("usernameInput");
  const joinButton = $("joinButton");

  const messages = $("messages");
  const messageInput = $("messageInput");
  const sendButton = $("sendButton");

  const gifSearchInput = $("gifSearchInput");
  const gifSearchButton = $("gifSearchButton");
  const gifResults = $("gifResults");

  const youtubeInputModal = $("youtubeInputModal");
  const youtubeUrlInput = $("youtubeUrlInput");
  const youtubeModal = $("youtubeModal");
  const youtubeFrame = $("youtubeFrame");

  let currentVoiceRoom = false;
  let isHost = false;
  let gifOffset = 0;
  let gifQuery = "";
  let gifLoading = false;

  function showChat() {
    loginScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");
  }

  function joinChat() {
    const name = String(usernameInput.value || "").trim();

    if (!name) return alert("Kullanıcı adını yaz.");
    if (name.length > 24) return alert("Kullanıcı adı en fazla 24 karakter.");

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

  joinButton.addEventListener("click", joinChat);
  usernameInput.value = username;

  usernameInput.addEventListener("keydown", e => {
    if (e.key === "Enter") joinChat();
  });

  socket.on("connect", () => {
    if (username) socket.emit("user:join", username);
  });

  function addMessage(data) {
    if (!data || !messages) return;

    const item = document.createElement("div");
    item.className = "message";

    const header = document.createElement("div");
    header.className = "message-header";

    const name = document.createElement("strong");
    name.textContent = data.username || "Kullanıcı";

    const time = document.createElement("small");
    time.textContent = new Date(data.time || Date.now())
      .toLocaleTimeString("tr-TR", {hour:"2-digit",minute:"2-digit"});

    header.append(name, time);

    const text = String(data.text || "");

    if (/^https?:\/\/.+\.gif(\?.*)?$/i.test(text)) {
      const img = document.createElement("img");
      img.src = text;
      img.alt = "GIF";
      img.className = "chat-gif";
      item.append(header, img);
    } else {
      const content = document.createElement("div");
      content.className = "message-content";
      content.textContent = text;
      item.append(header, content);
    }

    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  socket.on("chat:history", history => {
    messages.innerHTML = "";
    (Array.isArray(history) ? history : []).forEach(addMessage);
  });

  socket.on("chat:message", data => {
    addMessage(data);
  });

  function sendMessage() {
    const text = String(messageInput.value || "").trim();
    if (!text) return;

    if (!socket.connected) return alert("Sunucuya bağlı değilsin.");

    socket.emit("chat:message", text);
    messageInput.value = "";
  }

  sendButton.addEventListener("click", sendMessage);

  messageInput.addEventListener("keydown", e => {
    if (e.key === "Enter") sendMessage();
  });

  // GIF arama
  async function searchGifs(reset = true) {
    if (gifLoading) return;

    if (reset) {
      gifQuery = gifSearchInput.value.trim() || "funny";
      gifOffset = 0;
      gifResults.innerHTML = "";
      gifResults.classList.remove("hidden");
    }

    gifLoading = true;

    try {
      const params = new URLSearchParams({
        q: gifQuery,
        limit: "50",
        offset: String(gifOffset)
      });

      const response = await fetch("/api/gifs?" + params);
      const result = await response.json();

      if (!response.ok) throw new Error(result.error || "GIF arama hatası");

      (result.gifs || []).forEach(gif => {
        const button = document.createElement("button");
        button.className = "gif-result";

        const img = document.createElement("img");
        img.src = gif.preview || gif.url;
        img.alt = gif.title || "GIF";

        button.appendChild(img);
        button.addEventListener("click", () => {
          socket.emit("chat:message", gif.url);
          gifResults.classList.add("hidden");
        });

        gifResults.appendChild(button);
      });

      gifOffset = result.nextOffset || gifOffset + 50;

    } catch (error) {
      alert(error.message);
    } finally {
      gifLoading = false;
    }
  }

  gifSearchButton.addEventListener("click", () => searchGifs(true));

  gifSearchInput.addEventListener("keydown", e => {
    if (e.key === "Enter") searchGifs(true);
  });

  // Sesli oda durumunu app.js de takip eder
  socket.on("voice:host-status", data => {
    currentVoiceRoom = Boolean(data.inRoom);
    isHost = Boolean(data.isHost);
  });

  // YouTube penceresi
  $("youtubeOpenButton").addEventListener("click", () => {
    if (!currentVoiceRoom) {
      return alert("Önce bir sesli odaya katıl.");
    }

    if (!isHost) {
      return alert("YouTube videosunu yalnızca oda sahibi paylaşabilir.");
    }

    youtubeInputModal.classList.remove("hidden");
    youtubeUrlInput.focus();
  });

  $("youtubeCancelButton").addEventListener("click", () => {
    youtubeInputModal.classList.add("hidden");
  });

  function extractYoutubeId(value) {
    try {
      const url = new URL(value.trim());

      if (url.hostname.includes("youtu.be")) {
        return url.pathname.slice(1).split("/")[0];
      }

      if (url.hostname.includes("youtube.com")) {
        if (url.pathname === "/watch") {
          return url.searchParams.get("v");
        }

        const parts = url.pathname.split("/");
        const index = parts.findIndex(p =>
          ["embed", "shorts", "live"].includes(p)
        );

        if (index >= 0) return parts[index + 1];
      }
    } catch {}

    return null;
  }

  $("youtubePlayButton").addEventListener("click", () => {
    const url = youtubeUrlInput.value.trim();
    const videoId = extractYoutubeId(url);

    if (!videoId) {
      return alert("Geçerli bir YouTube URL'si yaz.");
    }

    socket.emit("youtube:play", videoId, result => {
      if (!result?.ok) {
        return alert(result?.error || "Video paylaşılamadı.");
      }

      youtubeInputModal.classList.add("hidden");
      youtubeUrlInput.value = "";
    });
  });

  function openYoutube(videoId) {
    youtubeFrame.src =
      "https://www.youtube.com/embed/" +
      encodeURIComponent(videoId) +
      "?autoplay=1&rel=0";

    youtubeModal.classList.remove("hidden");
  }

  function closeYoutube() {
    youtubeFrame.src = "";
    youtubeModal.classList.add("hidden");
  }

  $("youtubeCloseButton").addEventListener("click", () => {
    if (isHost && currentVoiceRoom) {
      socket.emit("youtube:close");
    } else {
      closeYoutube();
    }
  });

  socket.on("youtube:play", data => {
    if (data?.videoId) openYoutube(data.videoId);
  });

  socket.on("youtube:close", closeYoutube);

  // Başlangıç
  if (username) {
    usernameInput.value = username;
    showChat();
  } else {
    loginScreen.classList.remove("hidden");
    mainScreen.classList.add("hidden");
  }

  console.log("Chatbox app.js hazır.");
})();
