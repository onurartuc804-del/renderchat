(() => {
  const socket = window.chatboxSocket;
  if (!socket) {
    console.error("Chatbox Socket.IO bağlantısı bulunamadı.");
    return;
  }

  const $ = id => document.getElementById(id);

  const panel = $("voicePanel");
  const createBtn = $("createVoiceBtn");
  const joinBtn = $("joinVoiceBtn");
  const closeBtn = $("voiceCloseBtn");
  const leaveBtn = $("voiceLeaveBtn");
  const micBtn = $("voiceMicBtn");
  const textToggle = $("voiceTextToggle");

  const roomTitle = $("voiceRoomTitle");
  const status = $("voiceStatus");
  const peersContainer = $("voicePeers");

  const textPanel = $("voiceTextPanel");
  const voiceMessages = $("voiceMessages");
  const voiceMessageForm = $("voiceMessageForm");
  const voiceMessageInput = $("voiceMessageInput");

  const joinSound = $("joinSound");
  const leaveSound = $("leaveSound");

  let localStream = null;
  let currentRoom = "";
  let micEnabled = true;
  let isHost = false;

  const peerConnections = new Map();
  const peerNames = new Map();
  const pendingCandidates = new Map();

  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };

  function playSound(audio) {
    if (!audio) return;

    try {
      audio.pause();
      audio.currentTime = 0;

      const promise = audio.play();
      if (promise) promise.catch(() => {});
    } catch (error) {
      console.warn("Ses efekti oynatılamadı:", error);
    }
  }

  async function getMicrophone() {
    if (localStream) return localStream;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Mikrofon bu tarayıcıda desteklenmiyor.");
    }

    localStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      },
      video: false
    });

    return localStream;
  }

  function showRoom(name) {
    currentRoom = name;
    roomTitle.textContent = name + " sesli odası";
    status.textContent = "Sesli odaya bağlandın";
    panel.classList.remove("hidden");
    peersContainer.innerHTML = "";
    voiceMessages.innerHTML = "";
    micEnabled = true;
    micBtn.textContent = "🎙️ Mikrofon açık";
  }

  function addPeerCard(id, name) {
    peerNames.set(id, name || "Kullanıcı");

    let card = document.getElementById("voice-peer-" + id);
    if (card) return;

    card = document.createElement("div");
    card.className = "voice-peer";
    card.id = "voice-peer-" + id;
    card.textContent = name || "Kullanıcı";
    peersContainer.appendChild(card);
  }

  function removePeer(id) {
    const pc = peerConnections.get(id);

    if (pc) {
      pc.close();
      peerConnections.delete(id);
    }

    pendingCandidates.delete(id);
    peerNames.delete(id);

    const card = document.getElementById("voice-peer-" + id);
    if (card) card.remove();

    const audio = document.getElementById("voice-audio-" + id);
    if (audio) audio.remove();
  }

  function createPeerConnection(id, name) {
    if (peerConnections.has(id)) {
      return peerConnections.get(id);
    }

    const pc = new RTCPeerConnection(rtcConfig);
    peerConnections.set(id, pc);
    pendingCandidates.set(id, []);

    addPeerCard(id, name);

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = event => {
      if (!event.candidate) return;

      socket.emit("voice:signal", {
        to: id,
        data: {
          type: "candidate",
          candidate: event.candidate
        }
      });
    };

    pc.ontrack = event => {
      let audio = document.getElementById("voice-audio-" + id);

      if (!audio) {
        audio = document.createElement("audio");
        audio.id = "voice-audio-" + id;
        audio.autoplay = true;
        audio.playsInline = true;
        document.body.appendChild(audio);
      }

      audio.srcObject = event.streams[0];
      audio.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        status.textContent = "Ses bağlantısı kuruldu";
      }

      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        removePeer(id);
      }
    };

    return pc;
  }

  async function sendOffer(id, name) {
    const pc = createPeerConnection(id, name);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    socket.emit("voice:signal", {
      to: id,
      data: {
        type: "offer",
        sdp: pc.localDescription
      }
    });
  }

  async function createRoom() {
    if (currentRoom) return;

    try {
      await getMicrophone();

      socket.emit("voice:create", result => {
        if (!result?.ok) {
          alert(result?.error || "Oda oluşturulamadı.");
          stopMicrophone();
          return;
        }

        isHost = true;
        showRoom(result.roomName);
        playSound(joinSound);
      });
    } catch (error) {
      alert(error.message || "Mikrofon izni gerekli.");
    }
  }

  async function joinRoom() {
    if (currentRoom) return;

    const hostName = prompt("Oda sahibinin kullanıcı adını yaz:");
    if (!hostName || !hostName.trim()) return;

    try {
      await getMicrophone();

      socket.emit("voice:join", hostName.trim(), async result => {
        if (!result?.ok) {
          alert(result?.error || "Odaya katılınamadı.");
          stopMicrophone();
          return;
        }

        isHost = false;
        showRoom(result.roomName);
        playSound(joinSound);

        // Oda içindeki mevcut kişilerle bağlantı başlat
        for (const peer of result.peers || []) {
          await sendOffer(peer.id, peer.name);
        }
      });
    } catch (error) {
      alert(error.message || "Mikrofon izni gerekli.");
    }
  }

  function stopMicrophone() {
    if (!localStream) return;

    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  function closeRoomUI() {
    panel.classList.add("hidden");
    textPanel.classList.add("hidden");

    for (const id of [...peerConnections.keys()]) {
      removePeer(id);
    }

    peersContainer.innerHTML = "";
    voiceMessages.innerHTML = "";

    stopMicrophone();

    currentRoom = "";
    isHost = false;
    micEnabled = true;
  }

  function leaveRoom() {
    if (!currentRoom) return;

    playSound(leaveSound);
    socket.emit("voice:leave");
    closeRoomUI();
  }

  createBtn.addEventListener("click", createRoom);
  joinBtn.addEventListener("click", joinRoom);
  closeBtn.addEventListener("click", leaveRoom);
  leaveBtn.addEventListener("click", leaveRoom);

  micBtn.addEventListener("click", () => {
    if (!localStream) return;

    micEnabled = !micEnabled;

    localStream.getAudioTracks().forEach(track => {
      track.enabled = micEnabled;
    });

    micBtn.textContent = micEnabled
      ? "🎙️ Mikrofon açık"
      : "🔇 Mikrofon kapalı";
  });

  textToggle.addEventListener("click", () => {
    textPanel.classList.toggle("hidden");
  });

  voiceMessageForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = voiceMessageInput.value.trim();
    if (!text) return;

    socket.emit("voice:message", text);
    voiceMessageInput.value = "";
  });

  function addVoiceMessage(data) {
    const row = document.createElement("div");
    row.className = "voice-message";

    const name = document.createElement("strong");
    name.textContent = data.username + ": ";

    const text = document.createElement("span");
    text.textContent = data.text;

    row.append(name, text);
    voiceMessages.appendChild(row);
    voiceMessages.scrollTop = voiceMessages.scrollHeight;
  }

  socket.on("voice:message", addVoiceMessage);

  // Yeni kişi odaya katıldı
  socket.on("voice:peer-joined", data => {
    if (!currentRoom) return;

    addPeerCard(data.id, data.name);
    playSound(joinSound);
  });

  // Odadaki kişi ayrıldı
  socket.on("voice:peer-left", data => {
    if (!currentRoom) return;

    removePeer(data.id);
    playSound(leaveSound);
  });

  // Oda sahibi odayı kapattı
  socket.on("voice:room-closed", () => {
    if (!currentRoom) return;

    playSound(leaveSound);
    closeRoomUI();
    alert("Oda sahibi sesli odayı kapattı.");
  });

  // WebRTC offer / answer / ICE
  socket.on("voice:signal", async payload => {
    if (!currentRoom || !payload?.from || !payload?.data) return;

    const id = payload.from;
    const data = payload.data;

    try {
      let pc = peerConnections.get(id);

      if (!pc) {
        pc = createPeerConnection(id, peerNames.get(id) || "Kullanıcı");
      }

      if (data.type === "offer") {
        await pc.setRemoteDescription(
          new RTCSessionDescription(data.sdp)
        );

        const candidates = pendingCandidates.get(id) || [];
        for (const candidate of candidates) {
          await pc.addIceCandidate(candidate);
        }
        pendingCandidates.set(id, []);

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        socket.emit("voice:signal", {
          to: id,
          data: {
            type: "answer",
            sdp: pc.localDescription
          }
        });
      }

      if (data.type === "answer") {
        await pc.setRemoteDescription(
          new RTCSessionDescription(data.sdp)
        );

        const candidates = pendingCandidates.get(id) || [];
        for (const candidate of candidates) {
          await pc.addIceCandidate(candidate);
        }
        pendingCandidates.set(id, []);
      }

      if (data.type === "candidate" && data.candidate) {
        const candidate = new RTCIceCandidate(data.candidate);

        if (pc.remoteDescription) {
          await pc.addIceCandidate(candidate);
        } else {
          const queue = pendingCandidates.get(id) || [];
          queue.push(candidate);
          pendingCandidates.set(id, queue);
        }
      }
    } catch (error) {
      console.error("WebRTC bağlantı hatası:", error);
    }
  });
})();
