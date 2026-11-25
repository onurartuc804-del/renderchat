
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const socket = io();

  let username = "";
  let currentVoiceRoom = "";
  let isVoiceHost = false;

  const loginScreen = $("loginScreen");
  const mainScreen = $("mainScreen");
  const chatScreen = $("chatScreen");
  const gifScreen = $("gifScreen");
  const voiceScreen = $("voiceScreen");

  function showScreen(screen) {
    loginScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");

    chatScreen.classList.remove("hidden");
    gifScreen.classList.add("hidden");
    voiceScreen.classList.add("hidden");

    if (screen) {
      $(screen).classList.remove("hidden");
    }
  }

  function showChat() {
    showScreen(null);
  }

  function playSound(id) {
    const audio = $(id);
    if (!audio) return;

    audio.currentTime = 0;
    audio.play().catch(() => {});
  }

  // KAYIT
  function joinChat() {
    const name = $("usernameInput").value.trim();

    if (!name) {
      alert("Kullanıcı adını yaz.");
      return;
    }

    username = name.slice(0, 24);

    socket.emit("user:join", username);

    loginScreen.classList.add("hidden");
    mainScreen.classList.remove("hidden");
    showChat();
  }

  $("joinButton").addEventListener("click", joinChat);

  $("usernameInput").addEventListener("keydown", event => {
    if (event.key === "Enter") joinChat();
  });

  // SİMGELER
  $("openVoiceButton").addEventListener("click", () => {
    showScreen("voiceScreen");
  });

  $("openGifButton").addEventListener("click", () => {
    showScreen("gifScreen");
    $("gifSearchInput").focus();
  });

  $("openYoutubeButton").addEventListener("click", () => {
    $("youtubeInputModal").classList.remove("hidden");
  });

  // KAPATMA SİMGELERİ
  document.querySelectorAll("[data-close]").forEach(button => {
    button.addEventListener("click", () => {
      showChat();
    });
  });

  $("voiceLeaveButton").addEventListener("click", () => {
    showChat();
  });

  $("youtubeCancelButton").addEventListener("click", () => {
    $("youtubeInputModal").classList.add("hidden");
  });

  // SOHBET MESAJI
  function sendMessage() {
    const input = $("messageInput");
    const text = input.value.trim();

    if (!text) return;

    socket.emit("chat:message", text);
    input.value = "";
    input.focus();
  }

  $("sendButton").addEventListener("click", sendMessage);

  $("messageInput").addEventListener("keydown", event => {
    if (event.key === "Enter") sendMessage();
  });

  function addMessage(data) {
    const message = document.createElement("div");
    message.className = "message";

    const name = document.createElement("strong");
    name.textContent = data.username || "Kullanıcı";

    const text = document.createElement("span");
    text.textContent = data.text || "";

    message.append(name, text);
    $("messages").appendChild(message);

    $("messages").scrollTop = $("messages").scrollHeight;
  }

  socket.on("chat:message", addMessage);

  socket.on("chat:history", history => {
    $("messages").innerHTML = "";

    if (!Array.isArray(history)) return;

    history.forEach(addMessage);
  });

  // GIF ARAMA
  let gifOffset = 0;
  let gifQuery = "";

  async function searchGifs(reset = true) {
    const query = $("gifSearchInput").value.trim();

    if (!query) {
      alert("GIF aramak için bir şey yaz.");
      return;
    }

    if (reset) {
      gifQuery = query;
      gifOffset = 0;
      $("gifResults").innerHTML = "";
    }

    try {
      const response = await fetch(
        `/api/gifs?q=${encodeURIComponent(gifQuery)}&offset=${gifOffset}`
      );

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "GIF araması başarısız.");
      }

      const gifs = Array.isArray(data) ? data : data.gifs || [];

      gifs.forEach(gif => {
        const url = gif.url || gif.images?.fixed_height?.url;
        if (!url) return;

        const img = document.createElement("img");
        img.src = url;
        img.alt = "GIF";
        img.loading = "lazy";

        img.addEventListener("click", () => {
          socket.emit("chat:message", url);
          showChat();
        });

        $("gifResults").appendChild(img);
      });

      gifOffset += gifs.length;
    } catch (error) {
      alert("GIF yüklenemedi: " + error.message);
    }
  }

  $("gifSearchButton").addEventListener("click", () => searchGifs(true));

  $("gifSearchInput").addEventListener("keydown", event => {
    if (event.key === "Enter") searchGifs(true);
  });

  // YOUTUBE
  function getYoutubeId(url) {
    try {
      const parsed = new URL(url);
      let id = "";

      if (parsed.hostname.includes("youtu.be")) {
        id = parsed.pathname.slice(1);
      } else if (parsed.hostname.includes("youtube.com")) {
        if (parsed.pathname === "/watch") {
          id = parsed.searchParams.get("v") || "";
        } else if (parsed.pathname.startsWith("/embed/")) {
          id = parsed.pathname.split("/")[2] || "";
        } else if (parsed.pathname.startsWith("/shorts/")) {
          id = parsed.pathname.split("/")[2] || "";
        }
      }

      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : "";
    } catch {
      return "";
    }
  }

  $("youtubePlayButton").addEventListener("click", () => {
    const url = $("youtubeUrlInput").value.trim();
    const videoId = getYoutubeId(url);

    if (!videoId) {
      alert("Geçerli bir YouTube video bağlantısı gir.");
      return;
    }

    $("youtubeInputModal").classList.add("hidden");

    socket.emit("youtube:play", {
      videoId
    });
  });

  function playYoutube(videoId) {
    if (!videoId) return;

    $("youtubeFrame").src =
      `https://www.youtube.com/embed/${encodeURIComponent(videoId)}?autoplay=1`;

    $("youtubeModal").classList.remove("hidden");
  }

  function closeYoutube() {
    $("youtubeFrame").src = "";
    $("youtubeModal").classList.add("hidden");
  }

  $("youtubeCloseButton").addEventListener("click", () => {
    if (currentVoiceRoom && isVoiceHost) {
      socket.emit("youtube:close");
    } else {
      closeYoutube();
    }
  });

  socket.on("youtube:play", data => {
    playYoutube(data.videoId);
  });

  socket.on("youtube:close", closeYoutube);

  // ODA DURUMU
  socket.on("voice:host-status", data => {
    if (!data) return;

    currentVoiceRoom = data.roomName || "";
    isVoiceHost = !!data.isHost;
  });

  socket.on("voice:room-closed", () => {
    currentVoiceRoom = "";
    isVoiceHost = false;
    showChat();
  });

  // Dışarıdan kullanılabilsin
  window.Chatbox = {
    showChat,
    showScreen,
    playSound
  };
})();
