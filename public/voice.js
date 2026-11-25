
(() => {
  "use strict";

  // ==========================================
  // CHATBOX VOICE CHAT
  // WebRTC + Socket.IO
  // ==========================================

  const $ = id => document.getElementById(id);

  const socket = window.chatboxSocket;

  if (!socket) {
    console.error("Chatbox Socket.IO bağlantısı bulunamadı.");
    return;
  }

  // ==========================================
  // HTML ELEMENTLERİ
  // ==========================================

  const voiceScreen = $("voiceScreen");

  const createButton = $("voiceCreateButton");
  const joinButton = $("voiceJoinButton");

  const roomNameInput = $("voiceRoomNameInput");

  const roomTitle = $("voiceRoomTitle");
  const roomStatus = $("voiceRoomStatus");

  const roomUsers = $("voiceRoomUsers");

  const muteButton = $("voiceMuteButton");
  const leaveButton = $("voiceLeaveButton");

  const chatToggleButton = $("voiceChatToggleButton");
  const chatPanel = $("voiceChatPanel");

  const voiceMessages = $("voiceMessages");
  const voiceMessageInput = $("voiceMessageInput");
  const voiceMessageSendButton = $("voiceMessageSendButton");

  const audioContainer = $("voiceAudioContainer");

  // ==========================================
  // DURUM
  // ==========================================

  let localStream = null;
  let currentRoom = null;

  let muted = false;
  let roomActive = false;
  let connecting = false;

  const peers = new Map();
  const peerNames = new Map();
  const pendingCandidates = new Map();

  // ==========================================
  // SES ÇALMA
  // ==========================================

  function playRoomSound(type) {
    const sound = $(type === "open" ? "joinSound" : "leaveSound");

    if (!sound) {
      console.warn("Oda sesi HTML içinde bulunamadı.");
      return;
    }

    try {
      sound.pause();
      sound.currentTime = 0;
      sound.volume = 0.7;

      const playPromise = sound.play();

      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(error => {
          console.warn("Oda sesi çalınamadı:", error);
        });
      }
    } catch (error) {
      console.warn("Ses hatası:", error);
    }
  }

  // ==========================================
  // MİKROFON
  // ==========================================

  async function getMicrophone() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(
        "Mikrofon desteklenmiyor. HTTPS üzerinden açmalısın."
      );
    }

    return navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });
  }

  function stopMicrophone() {
    if (!localStream) return;

    localStream.getTracks().forEach(track => {
      track.stop();
    });

    localStream = null;
  }

  // ==========================================
  // EKRAN
  // ==========================================

  function showVoiceScreen() {
    if (voiceScreen) {
      voiceScreen.style.display = "block";
    }
  }

  function hideVoiceScreen() {
    if (voiceScreen) {
      voiceScreen.style.display = "none";
    }
  }

  // ==========================================
  // ODA DURUMU
  // ==========================================

  function setStatus(text) {
    if (roomStatus) {
      roomStatus.textContent = text;
    }
  }

  function setRoomTitle(name) {
    if (roomTitle) {
      roomTitle.textContent = "Sesli Oda: " + name;
    }
  }

  // ==========================================
  // KULLANICI LİSTESİ
  // ==========================================

  function renderRoomUsers() {
    if (!roomUsers) return;

    roomUsers.innerHTML = "";

    const localName = window.chatboxUsername || "Sen";

    const localUser = document.createElement("div");
    localUser.className = "online-user";

    const localDot = document.createElement("span");
    localDot.className = "online-dot";

    const localLabel = document.createElement("span");
    localLabel.textContent = localName + " (Sen)";

    localUser.append(localDot, localLabel);
    roomUsers.appendChild(localUser);

    peerNames.forEach((name, id) => {
      const user = document.createElement("div");
      user.className = "online-user";

      const dot = document.createElement("span");
      dot.className = "online-dot";

      const label = document.createElement("span");
      label.textContent = name || "Kullanıcı";

      user.append(dot, label);
      roomUsers.appendChild(user);
    });
  }

  // ==========================================
  // WEBRTC PEER OLUŞTUR
  // ==========================================

  function createPeer(peerId) {
    if (peers.has(peerId)) {
      return peers.get(peerId);
    }

    if (!localStream) {
      throw new Error("Mikrofon henüz açılmadı.");
    }

    const pc = new RTCPeerConnection({
      iceServers: [
        {
          urls: "stun:stun.l.google.com:19302"
        },
        {
          urls: "stun:stun1.l.google.com:19302"
        }
      ]
    });

    peers.set(peerId, pc);
    pendingCandidates.set(peerId, []);

    // Mikrofon sesini karşı tarafa gönder
    localStream.getTracks().forEach(track => {
      pc.addTrack(track, localStream);
    });

    // Karşı tarafın sesini al
    pc.ontrack = event => {
      const stream = event.streams && event.streams[0];

      if (!stream || !audioContainer) return;

      let audio = $("voice-audio-" + peerId);

      if (!audio) {
        audio = document.createElement("audio");
        audio.id = "voice-audio-" + peerId;
        audio.autoplay = true;
        audio.playsInline = true;
        audio.controls = false;

        audioContainer.appendChild(audio);
      }

      audio.srcObject = stream;

      audio.play().catch(error => {
        console.warn("Karşı tarafın sesi otomatik çalınamadı:", error);
      });
    };

    // ICE adaylarını karşı tarafa gönder
    pc.onicecandidate = event => {
      if (!event.candidate) return;

      socket.emit("voice:signal", {
        to: peerId,
        data: {
          type: "candidate",
          candidate: event.candidate
        }
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        setStatus("Sesli bağlantı kuruldu.");
      }

      if (pc.connectionState === "failed") {
        setStatus("Ses bağlantısı başarısız. TURN sunucusu gerekebilir.");
      }

      if (pc.connectionState === "disconnected") {
        setStatus("Ses bağlantısı kesildi.");
      }
    };

    return pc;
  }

  // ==========================================
  // WEBRTC OFFER GÖNDER
  // ==========================================

  async function makeOffer(peerId) {
    const pc = createPeer(peerId);

    const offer = await pc.createOffer();

    await pc.setLocalDescription(offer);

    socket.emit("voice:signal", {
      to: peerId,
      data: {
        type: "offer",
        sdp: pc.localDescription
      }
    });
  }

  // ==========================================
  // ICE ADAYLARINI EKLE
  // ==========================================

  async function flushCandidates(peerId, pc) {
    const list = pendingCandidates.get(peerId) || [];

    pendingCandidates.set(peerId, []);

    for (const candidate of list) {
      try {
        await pc.addIceCandidate(
          new RTCIceCandidate(candidate)
        );
      } catch (error) {
        console.warn("ICE adayı eklenemedi:", error);
      }
    }
  }

  // ==========================================
  // WEBRTC SİNYALLERİNİ AL
  // ==========================================

  socket.on("voice:signal", async payload => {
    if (!roomActive || !payload || !payload.from) return;

    const peerId = payload.from;
    const data = payload.data;

    if (!data || !data.type) return;

    try {
      if (data.type === "candidate") {
        const pc = peers.get(peerId);

        if (!pc || !pc.remoteDescription) {
          if (!pendingCandidates.has(peerId)) {
            pendingCandidates.set(peerId, []);
          }

          pendingCandidates.get(peerId).push(data.candidate);
          return;
        }

        await pc.addIceCandidate(
          new RTCIceCandidate(data.candidate)
        );

        return;
      }

      if (data.type === "offer") {
        const pc = createPeer(peerId);

        await pc.setRemoteDescription(
          new RTCSessionDescription(data.sdp)
        );

        await flushCandidates(peerId, pc);

        const answer = await pc.createAnswer();

        await pc.setLocalDescription(answer);

        socket.emit("voice:signal", {
          to: peerId,
          data: {
            type: "answer",
            sdp: pc.localDescription
          }
        });

        return;
      }

      if (data.type === "answer") {
        const pc = peers.get(peerId);

        if (!pc) return;

        await pc.setRemoteDescription(
          new RTCSessionDescription(data.sdp)
        );

        await flushCandidates(peerId, pc);
      }

    } catch (error) {
      console.error("WebRTC sinyal hatası:", error);
    }
  });

  // ==========================================
  // ODA OLUŞTUR
  // ==========================================

  async function createVoiceRoom() {
    if (connecting || roomActive) return;

    if (!socket.connected) {
      alert("Sunucuya bağlı değilsin.");
      return;
    }

    connecting = true;

    if (createButton) {
      createButton.disabled = true;
    }

    try {
      setStatus("Mikrofon açılıyor...");

      localStream = await getMicrophone();

      socket.emit("voice:create", result => {
        connecting = false;

        if (createButton) {
          createButton.disabled = false;
        }

        if (!result || !result.ok) {
          stopMicrophone();

          alert(result?.error || "Oda oluşturulamadı.");
          setStatus("Oda oluşturulamadı.");
          return;
        }

        currentRoom = result.roomName;
        roomActive = true;

        setRoomTitle(currentRoom);
        setStatus("Oda açıldı. Mikrofonun aktif.");

        showVoiceScreen();
        renderRoomUsers();

        // ODA AÇILMA SESİ
        playRoomSound("open");
      });

    } catch (error) {
      connecting = false;

      if (createButton) {
        createButton.disabled = false;
      }

      stopMicrophone();

      console.error(error);

      alert(
        "Mikrofon açılamadı. Tarayıcıdan mikrofon izni vermelisin."
      );

      setStatus("Mikrofon açılamadı.");
    }
  }

  // ==========================================
  // SESLİ ODAYA KATIL
  // ==========================================

  async function joinVoiceRoom() {
    if (connecting || roomActive) return;

    if (!socket.connected) {
      alert("Sunucuya bağlı değilsin.");
      return;
    }

    const hostName = String(
      roomNameInput?.value || ""
    ).trim();

    if (!hostName) {
      alert("Oda sahibinin kullanıcı adını yaz.");
      return;
    }

    connecting = true;

    if (joinButton) {
      joinButton.disabled = true;
    }

    try {
      setStatus("Mikrofon açılıyor...");

      localStream = await getMicrophone();

      socket.emit("voice:join", hostName, async result => {
        connecting = false;

        if (joinButton) {
          joinButton.disabled = false;
        }

        if (!result || !result.ok) {
          stopMicrophone();

          alert(result?.error || "Odaya katılınamadı.");
          setStatus("Odaya katılınamadı.");
          return;
        }

        currentRoom = result.roomName;
        roomActive = true;

        setRoomTitle(currentRoom);
        setStatus("Odaya katıldın. Ses bağlantısı kuruluyor.");

        showVoiceScreen();

        // ODA KATILMA SESİ
        playRoomSound("open");

        const existingPeers = Array.isArray(result.peers)
          ? result.peers
          : [];

        for (const peer of existingPeers) {
          peerNames.set(peer.id, peer.name || "Kullanıcı");
        }

        renderRoomUsers();

        // Yeni katılan kişi offer başlatır
        for (const peer of existingPeers) {
          try {
            await makeOffer(peer.id);
          } catch (error) {
            console.error("Offer oluşturulamadı:", error);
          }
        }
      });

    } catch (error) {
      connecting = false;

      if (joinButton) {
        joinButton.disabled = false;
      }

      stopMicrophone();

      console.error(error);

      alert("Mikrofon açılamadı. Mikrofon iznini kontrol et.");
      setStatus("Mikrofon açılamadı.");
    }
  }

  // ==========================================
  // YENİ KULLANICI ODAYA KATILDI
  // ==========================================

  socket.on("voice:peer-joined", data => {
    if (!roomActive || !data || !data.id) return;

    peerNames.set(data.id, data.name || "Kullanıcı");

    renderRoomUsers();

    // Yeni kullanıcı kendi offer'ını gönderecek
  });

  // ==========================================
  // KULLANICI ODADAN AYRILDI
  // ==========================================

  function removePeer(peerId) {
    const pc = peers.get(peerId);

    if (pc) {
      pc.close();
      peers.delete(peerId);
    }

    pendingCandidates.delete(peerId);
    peerNames.delete(peerId);

    const audio = $("voice-audio-" + peerId);

    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }

    renderRoomUsers();
  }

  socket.on("voice:peer-left", data => {
    if (!data || !data.id) return;

    removePeer(data.id);
  });

  // ==========================================
  // SESLİ ODA MESAJLARI
  // ==========================================

  function addVoiceMessage(data) {
    if (!voiceMessages || !data) return;

    const item = document.createElement("div");
    item.className = "voice-message";

    const name = document.createElement("strong");
    name.textContent = (data.username || "Kullanıcı") + ": ";

    const text = document.createElement("span");
    text.textContent = data.text || "";

    item.append(name, text);

    voiceMessages.appendChild(item);

    voiceMessages.scrollTop = voiceMessages.scrollHeight;
  }

  socket.on("voice:message", data => {
    if (!roomActive) return;

    addVoiceMessage(data);
  });

  function sendVoiceMessage() {
    const text = String(
      voiceMessageInput?.value || ""
    ).trim();

    if (!text || !roomActive) return;

    socket.emit("voice:message", text);

    if (voiceMessageInput) {
      voiceMessageInput.value = "";
      voiceMessageInput.focus();
    }
  }

  if (voiceMessageSendButton) {
    voiceMessageSendButton.addEventListener(
      "click",
      sendVoiceMessage
    );
  }

  if (voiceMessageInput) {
    voiceMessageInput.addEventListener("keydown", event => {
      if (event.key === "Enter") {
        sendVoiceMessage();
      }
    });
  }

  // ==========================================
  // MİKROFONU KAPAT / AÇ
  // ==========================================

  if (muteButton) {
    muteButton.addEventListener("click", () => {
      if (!localStream) return;

      muted = !muted;

      localStream.getAudioTracks().forEach(track => {
        track.enabled = !muted;
      });

      muteButton.textContent = muted
        ? "Mikrofonu Aç"
        : "Mikrofonu Kapat";

      setStatus(
        muted
          ? "Mikrofon kapalı."
          : "Mikrofon açık."
      );
    });
  }

  // ==========================================
  // ODA SOHBETİNİ AÇ / KAPAT
  // ==========================================

  if (chatToggleButton) {
    chatToggleButton.addEventListener("click", () => {
      if (!chatPanel) return;

      const isHidden = chatPanel.style.display === "none";

      chatPanel.style.display = isHidden
        ? "block"
        : "none";
    });
  }

  // ==========================================
  // ODADAN AYRIL
  // ==========================================

  function closeVoiceRoom(playSoundOnClose = true) {
    if (!roomActive && !localStream) return;

    roomActive = false;
    connecting = false;

    socket.emit("voice:leave");

    // Tüm WebRTC bağlantılarını kapat
    peers.forEach(pc => {
      pc.close();
    });

    peers.clear();
    peerNames.clear();
    pendingCandidates.clear();

    // Ses elementlerini temizle
    if (audioContainer) {
      audioContainer.innerHTML = "";
    }

    // Mikrofonu kapat
    stopMicrophone();

    currentRoom = null;
    muted = false;

    if (muteButton) {
      muteButton.textContent = "Mikrofonu Kapat";
    }

    if (voiceMessages) {
      voiceMessages.innerHTML = "";
    }

    hideVoiceScreen();

    setStatus("Odadan ayrıldın.");

    // ODA KAPANMA / AYRILMA SESİ
    if (playSoundOnClose) {
      playRoomSound("close");
    }
  }

  if (leaveButton) {
    leaveButton.addEventListener("click", () => {
      closeVoiceRoom(true);
    });
  }

  // ==========================================
  // ODA SAHİBİ ODAYI KAPATTI
  // ==========================================

  socket.on("voice:room-closed", () => {
    closeVoiceRoom(true);

    alert("Oda sahibi sesli odayı kapattı.");
  });

  // ==========================================
  // BUTONLAR
  // ==========================================

  if (createButton) {
    createButton.addEventListener("click", createVoiceRoom);
  }

  if (joinButton) {
    joinButton.addEventListener("click", joinVoiceRoom);
  }

  // ==========================================
  // BAĞLANTI KESİLİRSE
  // ==========================================

  socket.on("disconnect", () => {
    if (roomActive || localStream) {
      closeVoiceRoom(false);
      setStatus("Sunucu bağlantısı kesildi.");
    }
  });

  // ==========================================
  // BAŞLANGIÇ
  // ==========================================

  if (chatPanel) {
    chatPanel.style.display = "block";
  }

  console.log("Chatbox voice.js yüklendi.");

})();
