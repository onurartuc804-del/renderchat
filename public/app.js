
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const socket = io();

  let username = "";
  let currentRoom = "";
  let ownerId = null;
  let isOwner = false;

  let voiceStream = null;
  let ytPlayer = null;
  let pendingVideoId = null;
  let ytApiReady = false;

  const peers = new Map();
  const iceServers = [
    { urls: "stun:stun.l.google.com:19302" }
  ];

  function toast(message) {
    const el = $("toast");
    el.textContent = message;
    el.classList.remove("hidden");

    clearTimeout(toast.timer);

    toast.timer = setTimeout(
      () => el.classList.add("hidden"),
      2600
    );
  }

  function sound(freq = 620) {
    try {
      const ctx = new (
        window.AudioContext ||
        window.webkitAudioContext
      )();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.frequency.value = freq;
      osc.type = "sine";

      gain.gain.setValueAtTime(
        .08,
        ctx.currentTime
      );

      gain.gain.exponentialRampToValueAtTime(
        .001,
        ctx.currentTime + .16
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + .17);

      osc.onended = () => ctx.close();
    } catch (_) {}
  }

  function showModal(id) {
    $(id).classList.remove("hidden");
  }

  function hideModal(id) {
    $(id).classList.add("hidden");
  }

  document.querySelectorAll("[data-close]")
    .forEach(btn => {
      btn.addEventListener("click", () => {
        hideModal(btn.dataset.close);
      });
    });

  document.querySelectorAll(".modal")
    .forEach(modal => {
      modal.addEventListener("click", e => {
        if (e.target === modal) {
          modal.classList.add("hidden");
        }
      });
    });

  function addMessage(username, text, time = Date.now()) {
    const wrap = document.createElement("article");
    wrap.className = "message";

    const head = document.createElement("div");
    head.className = "message-head";

    head.textContent =
      `${username} · ${new Date(time).toLocaleTimeString(
        "tr-TR",
        {
          hour: "2-digit",
          minute: "2-digit"
        }
      )}`;

    const body = document.createElement("div");
    body.className = "message-text";
    body.textContent = text;

    wrap.append(head, body);

    $("messages").append(wrap);
    scrollMessages();
  }

  function addGif(username, url, time) {
    const wrap = document.createElement("article");
    wrap.className = "message gif-message";

    const head = document.createElement("div");
    head.className = "message-head";
    head.textContent = `${username} · GIF`;

    const img = document.createElement("img");
    img.src = url;
    img.alt = "Gönderilen GIF";
    img.loading = "lazy";

    wrap.append(head, img);

    $("messages").append(wrap);
    scrollMessages();
  }

  function systemMessage(text) {
    const el = document.createElement("div");
    el.className = "system-message";
    el.textContent = text;

    $("messages").append(el);
    scrollMessages();
  }

  function scrollMessages() {
    $("messages").scrollTop =
      $("messages").scrollHeight;
  }

  function renderUsers(users = []) {
    $("usersList").replaceChildren();

    users.forEach(user => {
      const row = document.createElement("div");
      row.className = "user-row";

      row.append(
        document.createTextNode(user.username)
      );

      if (user.id === ownerId) {
        const tag = document.createElement("span");
        tag.className = "owner-tag";
        tag.textContent = "★ Sahip";
        row.append(tag);
      }

      $("usersList").append(row);
    });

    isOwner = socket.id === ownerId;

    $("youtubeButton").classList.toggle(
      "hidden",
      !isOwner
    );
  }

  function joinRoom(room) {
    const cleanRoom = String(room || "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 32);

    if (!username || !cleanRoom) {
      return toast("Kullanıcı adı ve oda adı gir.");
    }

    socket.emit("joinRoom", {
      username,
      room: cleanRoom
    });
  }

  $("joinButton").addEventListener("click", () => {
    username = $("usernameInput")
      .value
      .trim()
      .slice(0, 24) || "Misafir";

    joinRoom($("roomInput").value);
  });

  $("roomInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      $("joinButton").click();
    }
  });

  $("sendButton").addEventListener(
    "click",
    sendMessage
  );

  $("messageInput").addEventListener("keydown", e => {
    if (e.key === "Enter") sendMessage();
  });

  function sendMessage() {
    const input = $("messageInput");
    const text = input.value.trim();

    if (!text) return;

    socket.emit("chatMessage", { text });
    input.value = "";
  }

  $("roomMenuButton").addEventListener("click", () => {
    $("roomMenu").classList.toggle("hidden");
  });

  $("createRoomOption").addEventListener("click", () => {
    $("roomMenu").classList.add("hidden");

    $("roomModalTitle").textContent = "Oda oluştur";
    $("modalRoomSubmit").textContent = "Oluştur";
    $("modalRoomInput").value = "";

    showModal("roomModal");
  });

  $("joinRoomOption").addEventListener("click", () => {
    $("roomMenu").classList.add("hidden");

    $("roomModalTitle").textContent = "Odaya katıl";
    $("modalRoomSubmit").textContent = "Katıl";
    $("modalRoomInput").value = "";

    showModal("roomModal");
  });

  $("roomInfoOption").addEventListener("click", () => {
    $("roomMenu").classList.add("hidden");

    toast(
      `Oda: ${currentRoom}${
        isOwner ? " · Oda sahibi sensin" : ""
      }`
    );
  });

  $("modalRoomSubmit").addEventListener("click", () => {
    hideModal("roomModal");
    joinRoom($("modalRoomInput").value);
  });

  $("modalRoomInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
      $("modalRoomSubmit").click();
    }
  });

  $("leaveButton").addEventListener(
    "click",
    leaveRoom
  );

  function leaveRoom() {
    stopVoice();

    socket.emit("leaveRoom");

    currentRoom = "";
    ownerId = null;
    isOwner = false;

    $("chatScreen").classList.add("hidden");
    $("loginScreen").classList.remove("hidden");
    $("messages").replaceChildren();

    closeVideoLocal();
    sound(300);
  }

  function getYouTubeId(value) {
    try {
      const url = new URL(value.trim());
      let id = "";

      if (
        url.hostname === "youtu.be" ||
        url.hostname.endsWith(".youtu.be")
      ) {
        id =
          url.pathname
            .split("/")
            .filter(Boolean)[0] || "";
      } else if (
        /(^|\.)youtube\.com$/i.test(url.hostname)
      ) {
        if (url.pathname === "/watch") {
          id = url.searchParams.get("v") || "";
        } else if (
          /^\/(embed|shorts|live)\//.test(
            url.pathname
          )
        ) {
          id = url.pathname.split("/")[2] || "";
        }
      }

      return /^[\w-]{11}$/.test(id) ? id : "";
    } catch (_) {
      return "";
    }
  }

  $("youtubeButton").addEventListener("click", () => {
    if (!isOwner) {
      return toast(
        "YouTube paylaşımını yalnızca oda sahibi yapabilir."
      );
    }

    $("youtubeError").textContent = "";
    $("youtubeUrlInput").value = "";

    showModal("youtubeModal");
  });

  $("youtubeShareButton").addEventListener(
    "click",
    () => {
      const id = getYouTubeId(
        $("youtubeUrlInput").value
      );

      if (!id) {
        $("youtubeError").textContent =
          "Geçerli bir YouTube video URL'si gir.";
        return;
      }

      socket.emit("youtubeShare", {
        videoId: id
      });

      hideModal("youtubeModal");
    }
  );

  $("youtubeUrlInput").addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") {
        $("youtubeShareButton").click();
      }
    }
  );

  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) {
      ytApiReady = true;
      createYouTubePlayer();
      return;
    }

    pendingVideoId = pendingVideoId || "";

    if (
      document.getElementById("youtube-iframe-api")
    ) {
      return;
    }

    const script = document.createElement("script");
    script.id = "youtube-iframe-api";
    script.src =
      "https://www.youtube.com/iframe_api";

    document.head.append(script);

    window.onYouTubeIframeAPIReady = () => {
      ytApiReady = true;
      createYouTubePlayer();
    };
  }

  function openVideo(videoId) {
    pendingVideoId = videoId;

    $("youtubeFrameWrap").replaceChildren();

    const target = document.createElement("div");
    target.id = "youtube-player";
    target.className = "video-frame";

    $("youtubeFrameWrap").append(target);
    $("youtubePlayer").classList.remove("hidden");

    loadYouTubeApi();
  }

  function createYouTubePlayer() {
    if (
      !ytApiReady ||
      !pendingVideoId ||
      !window.YT ||
      !window.YT.Player
    ) {
      return;
    }

    const videoId = pendingVideoId;
    pendingVideoId = null;

    if (
      ytPlayer &&
      typeof ytPlayer.destroy === "function"
    ) {
      try {
        ytPlayer.destroy();
      } catch (_) {}

      ytPlayer = null;
    }

    ytPlayer = new YT.Player("youtube-player", {
      videoId,

      playerVars: {
        autoplay: 1,
        rel: 0
      },

      events: {
        onStateChange: event => {
          if (event.data === YT.PlayerState.ENDED) {
            if (isOwner) {
              socket.emit("youtubeClose");
            } else {
              closeVideoLocal();
            }
          }
        }
      }
    });
  }

  function closeVideoLocal() {
    pendingVideoId = null;

    if (
      ytPlayer &&
      typeof ytPlayer.destroy === "function"
    ) {
      try {
        ytPlayer.destroy();
      } catch (_) {}

      ytPlayer = null;
    }

    $("youtubePlayer").classList.add("hidden");
    $("youtubeFrameWrap").replaceChildren();
  }

  $("youtubeCloseButton").addEventListener(
    "click",
    () => {
      if (isOwner) {
        socket.emit("youtubeClose");
      } else {
        toast(
          "Videoyu oda sahibi kapatabilir."
        );
      }
    }
  );

  $("gifButton").addEventListener("click", () => {
    showModal("gifModal");
    $("gifSearchInput").focus();
  });

  $("gifSearchButton").addEventListener(
    "click",
    searchGifs
  );

  $("gifSearchInput").addEventListener(
    "keydown",
    e => {
      if (e.key === "Enter") searchGifs();
    }
  );

  function searchGifs() {
    const q = $("gifSearchInput").value.trim();

    if (!q) {
      return toast(
        "GIF aramak için bir kelime yaz."
      );
    }

    $("gifResults").textContent = "Aranıyor...";
    socket.emit("gifSearch", q);
  }

  socket.on("gifResults", result => {
    const container = $("gifResults");
    container.replaceChildren();

    if (result.error) {
      container.textContent = result.error;
      return;
    }

    if (!result.gifs.length) {
      container.textContent = "GIF bulunamadı.";
      return;
    }

    result.gifs.forEach(gif => {
      const button = document.createElement("button");
      const img = document.createElement("img");

      img.src = gif.preview || gif.url;
      img.alt = gif.title || "GIF";
      img.loading = "lazy";

      button.append(img);
      button.title = gif.title || "GIF gönder";

      button.addEventListener("click", () => {
        socket.emit("sendGif", {
          url: gif.url
        });

        hideModal("gifModal");
      });

      container.append(button);
    });
  });

  // WebRTC voice chat, peer-to-peer audio.
  $("voiceButton").addEventListener(
    "click",
    async () => {
      if (voiceStream) {
        stopVoice();
        return;
      }

      try {
        voiceStream =
          await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: false
          });

        $("voiceButton").textContent =
          "🔇 Sesli sohbetten çık";

        $("voiceStatus").textContent =
          "Sesli sohbet açık";

        socket.emit("voiceJoin");
        toast("Mikrofon açıldı.");
      } catch (err) {
        toast(
          "Mikrofon izni verilmedi veya mikrofon kullanılamıyor."
        );
      }
    }
  );

  function makePeer(peerId, initiator) {
    if (!voiceStream || peers.has(peerId)) {
      return peers.get(peerId);
    }

    const pc = new RTCPeerConnection({
      iceServers
    });

    peers.set(peerId, pc);

    voiceStream.getTracks().forEach(track => {
      pc.addTrack(track, voiceStream);
    });

    pc.onicecandidate = e => {
      if (e.candidate) {
        socket.emit("voiceSignal", {
          to: peerId,
          signal: {
            candidate: e.candidate
          }
        });
      }
    };

    pc.ontrack = e => {
      let audio = document.getElementById(
        `audio-${peerId}`
      );

      if (!audio) {
        audio = document.createElement("audio");
        audio.id = `audio-${peerId}`;
        audio.autoplay = true;
        audio.className = "voice-audio";

        document.body.append(audio);
      }

      audio.srcObject = e.streams[0];

      audio.play().catch(() => {
        toast("Ses için ekrana dokun.");
      });
    };

    pc.onconnectionstatechange = () => {
      if (
        [
          "failed",
          "closed",
          "disconnected"
        ].includes(pc.connectionState)
      ) {
        removePeer(peerId);
      }
    };

    if (initiator) {
      pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
          socket.emit("voiceSignal", {
            to: peerId,
            signal: {
              description: pc.localDescription
            }
          });
        })
        .catch(() => {});
    }

    return pc;
  }

  socket.on("voicePeers", list => {
    list.forEach(peer => {
      makePeer(peer.id, true);
    });
  });

  socket.on("voicePeerJoined", peer => {
    if (voiceStream) {
      makePeer(peer.id, false);
    }
  });

  socket.on(
    "voiceSignal",
    async ({ from, signal }) => {
      if (!voiceStream) return;

      const pc = makePeer(from, false);
      if (!pc) return;

      try {
        if (signal.description) {
          await pc.setRemoteDescription(
            signal.description
          );

          if (
            signal.description.type === "offer"
          ) {
            const answer = await pc.createAnswer();

            await pc.setLocalDescription(answer);

            socket.emit("voiceSignal", {
              to: from,
              signal: {
                description: pc.localDescription
              }
            });
          }
        } else if (signal.candidate) {
          await pc.addIceCandidate(
            signal.candidate
          );
        }
      } catch (_) {}
    }
  );

  socket.on("voicePeerLeft", ({ id }) => {
    removePeer(id);
  });

  function removePeer(id) {
    const pc = peers.get(id);

    if (pc) pc.close();

    peers.delete(id);

    const audio = document.getElementById(
      `audio-${id}`
    );

    if (audio) audio.remove();
  }

  function stopVoice() {
    if (!voiceStream) return;

    socket.emit("voiceLeave");

    voiceStream.getTracks().forEach(track => {
      track.stop();
    });

    voiceStream = null;

    [...peers.keys()].forEach(removePeer);

    $("voiceButton").textContent =
      "🎙 Sesli sohbete katıl";

    $("voiceStatus").textContent =
      "Sesli sohbet kapalı";
  }

  socket.on("joined", data => {
    currentRoom = data.room;
    ownerId = data.ownerId;

    $("roomTitle").textContent =
      `· ${currentRoom}`;

    $("loginScreen").classList.add("hidden");
    $("chatScreen").classList.remove("hidden");

    $("messages").replaceChildren();

    renderUsers(data.users);

    systemMessage(
      `${currentRoom} odasına hoş geldin!`
    );

    sound(720);
  });

  socket.on("roomState", data => {
    if (data.room !== currentRoom) return;

    ownerId = data.ownerId;
    renderUsers(data.users);
  });

  socket.on("chatMessage", data => {
    addMessage(
      data.username,
      data.text,
      data.time
    );
  });

  socket.on("gifMessage", data => {
    addGif(
      data.username,
      data.url,
      data.time
    );
  });

  socket.on("systemMessage", data => {
    systemMessage(data.text);
    sound(430);
  });

  socket.on("youtubeOpen", data => {
    openVideo(data.videoId);
  });

  socket.on("youtubeClose", closeVideoLocal);

  socket.on("errorMessage", message => {
    toast(message);
  });

  socket.on("connect", () => {
    if (currentRoom) {
      joinRoom(currentRoom);
    }
  });

  window.addEventListener("beforeunload", () => {
    stopVoice();
    socket.emit("leaveRoom");
  });
})();
