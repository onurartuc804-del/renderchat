(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const createBtn = $("createVoiceRoom");
  const joinBtn = $("joinVoiceRoom");
  const roomModal = $("voiceRoomModal");
  const closeRoomModal = $("closeVoiceRoomModal");
  const joinRoomForm = $("joinVoiceRoomForm");
  const roomHostInput = $("roomHostName");
  const roomStatus = $("voiceRoomStatus");
  const voiceBar = $("voiceBar");
  const voiceRoomTitle = $("voiceRoomTitle");
  const voiceMembers = $("voiceMembers");
  const micBtn = $("voiceMicButton");
  const roomChatBtn = $("voiceChatButton");
  const leaveBtn = $("leaveVoiceRoom");
  const roomChat = $("voiceChatPanel");
  const roomChatMessages = $("voiceChatMessages");
  const roomChatForm = $("voiceChatForm");
  const roomChatInput = $("voiceChatInput");
  const audioBin = $("voiceAudioBin");

  let socket = null;
  let room = null;
  let localStream = null;
  let micOn = true;
  const peers = new Map();
  const remoteAudio = new Map();
  let joinSound, leaveSound;

  function toast(message) {
    const node = $("toast");
    if (!node) return;
    node.textContent = message;
    node.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("show"), 2800);
  }

  function getSocket() {
    socket = window.chatboxSocket || null;
    if (!socket || !socket.connected) {
      toast("Sohbet bağlantısı hazır değil.");
      return null;
    }
    return socket;
  }

  function playSound(kind) {
    const audio = kind === "join" ? joinSound : leaveSound;
    if (!audio) return;
    try { audio.currentTime = 0; audio.play().catch(() => {}); } catch (_) {}
  }

  function openModal() {
    roomStatus.textContent = "Odaya katılmak için oda kuran kişinin kullanıcı adını yaz.";
    roomModal.classList.remove("hidden");
    roomModal.setAttribute("aria-hidden", "false");
    roomHostInput.focus();
  }
  function closeModal() {
    roomModal.classList.add("hidden");
    roomModal.setAttribute("aria-hidden", "true");
  }

  async function requestMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("Bu tarayıcı mikrofon erişimini desteklemiyor.");
    }
    return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
  }

  function showRoom(hostName) {
    voiceRoomTitle.textContent = `${hostName} adlı kişinin sesli odası`;
    voiceBar.classList.remove("hidden");
    roomChat.classList.add("hidden");
    micBtn.textContent = "🎙 Mikrofon açık";
    micBtn.classList.remove("voice-muted");
    micOn = true;
    renderRoomMembers();
  }

  function renderRoomMembers() {
    if (!voiceMembers) return;
    voiceMembers.replaceChildren();
    if (!room) return;
    room.members.forEach(member => {
      const pill = document.createElement("span");
      pill.className = "voice-member-pill";
      pill.textContent = member.username + (member.id === socket.id ? " (sen)" : "");
      voiceMembers.appendChild(pill);
    });
  }

  function makePeer(peerId, peerName, initiator) {
    if (peers.has(peerId)) return peers.get(peerId);
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
      ]
    });
    peers.set(peerId, pc);
    if (localStream) localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    pc.onicecandidate = event => {
      if (event.candidate && socket) socket.emit("voice:signal", { to: peerId, signal: { candidate: event.candidate } });
    };
    pc.ontrack = event => {
      let audio = remoteAudio.get(peerId);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        audio.playsInline = true;
        audio.setAttribute("aria-label", `${peerName} ses`);
        audioBin.appendChild(audio);
        remoteAudio.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
      audio.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) removePeer(peerId);
    };
    if (initiator) {
      pc.createOffer().then(offer => pc.setLocalDescription(offer)).then(() => {
        socket.emit("voice:signal", { to: peerId, signal: { description: pc.localDescription } });
      }).catch(() => toast("Ses bağlantısı kurulamadı."));
    }
    return pc;
  }

  async function handleSignal(from, signal) {
    const member = room && room.members.find(item => item.id === from);
    const pc = makePeer(from, member ? member.username : "Katılımcı", false);
    try {
      if (signal.description) {
        await pc.setRemoteDescription(signal.description);
        if (signal.description.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          socket.emit("voice:signal", { to: from, signal: { description: pc.localDescription } });
        }
      } else if (signal.candidate) {
        await pc.addIceCandidate(signal.candidate);
      }
    } catch (error) { console.error("WebRTC signal error", error); }
  }

  function removePeer(peerId) {
    const pc = peers.get(peerId);
    if (pc) { try { pc.close(); } catch (_) {} peers.delete(peerId); }
    const audio = remoteAudio.get(peerId);
    if (audio) { audio.srcObject = null; audio.remove(); remoteAudio.delete(peerId); }
  }

  async function createRoom() {
    if (room) return toast("Zaten bir sesli odadasın.");
    const activeSocket = getSocket();
    if (!activeSocket) return;
    try {
      localStream = await requestMic();
      const hostName = window.chatboxUsername || localStorage.getItem("chatbox_username") || "Kullanıcı";
      activeSocket.emit("voice:room:create", {}, response => {
        if (!response || !response.ok) {
          localStream.getTracks().forEach(track => track.stop()); localStream = null;
          toast(response && response.error || "Oda oluşturulamadı."); return;
        }
        room = response.room;
        showRoom(hostName);
        toast("Sesli oda kuruldu. Arkadaşların kullanıcı adınla katılabilir.");
      });
    } catch (error) {
      toast(error.name === "NotAllowedError" ? "Mikrofon izni verilmedi." : error.message || "Mikrofon açılamadı.");
    }
  }

  async function joinRoom(hostName) {
    if (room) return toast("Zaten bir sesli odadasın.");
    const activeSocket = getSocket();
    if (!activeSocket) return;
    hostName = String(hostName || "").trim();
    if (!hostName) return toast("Oda kuran kişinin kullanıcı adını yaz.");
    try {
      localStream = await requestMic();
      activeSocket.emit("voice:room:join", { hostName }, response => {
        if (!response || !response.ok) {
          localStream.getTracks().forEach(track => track.stop()); localStream = null;
          roomStatus.textContent = response && response.error || "Odaya katılınamadı.";
          toast(roomStatus.textContent); return;
        }
        room = response.room;
        closeModal();
        showRoom(room.hostName);
        toast("Sesli odaya katıldın.");
      });
    } catch (error) {
      toast(error.name === "NotAllowedError" ? "Mikrofon izni verilmedi." : error.message || "Mikrofon açılamadı.");
    }
  }

  function leaveRoom() {
    if (!room) return;
    if (socket && socket.connected) socket.emit("voice:room:leave");
    peers.forEach((_, id) => removePeer(id));
    if (localStream) { localStream.getTracks().forEach(track => track.stop()); localStream = null; }
    room = null;
    voiceBar.classList.add("hidden");
    roomChat.classList.add("hidden");
    roomChatMessages.replaceChildren();
    toast("Sesli odadan ayrıldın.");
  }

  function renderRoomChat(message) {
    const row = document.createElement("div");
    row.className = "voice-chat-message";
    const name = document.createElement("strong"); name.textContent = message.username || "Kullanıcı";
    const text = document.createElement("span"); text.textContent = message.text || "";
    row.append(name, text); roomChatMessages.appendChild(row);
    roomChatMessages.scrollTop = roomChatMessages.scrollHeight;
  }

  createBtn.addEventListener("click", createRoom);
  joinBtn.addEventListener("click", openModal);
  closeRoomModal.addEventListener("click", closeModal);
  roomModal.addEventListener("click", event => { if (event.target === roomModal) closeModal(); });
  joinRoomForm.addEventListener("submit", event => { event.preventDefault(); joinRoom(roomHostInput.value); });
  micBtn.addEventListener("click", () => {
    if (!localStream) return;
    micOn = !micOn;
    localStream.getAudioTracks().forEach(track => track.enabled = micOn);
    micBtn.textContent = micOn ? "🎙 Mikrofon açık" : "🔇 Mikrofon kapalı";
    micBtn.classList.toggle("voice-muted", !micOn);
  });
  roomChatBtn.addEventListener("click", () => roomChat.classList.toggle("hidden"));
  leaveBtn.addEventListener("click", leaveRoom);
  roomChatForm.addEventListener("submit", event => {
    event.preventDefault();
    const text = roomChatInput.value.trim();
    if (!text || !room || !socket) return;
    socket.emit("voice:room:chat", { text });
    roomChatInput.value = "";
  });

  joinSound = new Audio("/sounds/join.m4a");
  leaveSound = new Audio("/sounds/leave.m4a");
  joinSound.preload = "auto"; leaveSound.preload = "auto";

  // App.js socket bağlantısını kurduğunda aynı socket'i kullan.
  const waitForSocket = setInterval(() => {
    if (!window.chatboxSocket) return;
    clearInterval(waitForSocket);
    socket = window.chatboxSocket;
    socket.on("voice:room:update", data => {
      if (!room || !data || data.roomId !== room.id) return;
      const previousIds = new Set(room.members.map(member => member.id));
      room.members = data.members;
      renderRoomMembers();
      data.members.forEach(member => {
        if (member.id !== socket.id && !previousIds.has(member.id)) {
          playSound("join");
          makePeer(member.id, member.username, true);
        }
      });
    });
    socket.on("voice:member:left", data => {
      if (!room || data.roomId !== room.id) return;
      playSound("leave");
      removePeer(data.id);
      room.members = room.members.filter(member => member.id !== data.id);
      renderRoomMembers();
    });
    socket.on("voice:signal", data => { if (room && data && data.from) handleSignal(data.from, data.signal); });
    socket.on("voice:room:chat", message => { if (room && message.roomId === room.id) renderRoomChat(message); });
    socket.on("disconnect", () => { if (room) leaveRoom(); });
  }, 150);
})();
