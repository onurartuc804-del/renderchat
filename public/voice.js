
(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const socket = window.Chatbox.socket;

  let localStream = null;
  let currentRoom = "";
  let isHost = false;
  let muted = false;

  const peers = new Map();

  const rtcConfig = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" }
    ]
  };

  function setStatus(text) {
    $("voiceRoomStatus").textContent = text;
  }

  function clearPeers() {
    for (const pc of peers.values()) {
      pc.close();
    }

    peers.clear();
    $("voiceAudioContainer").innerHTML = "";
  }

  async function startMicrophone() {
    if (localStream) return localStream;

    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false
      });

      return localStream;
    } catch (error) {
      setStatus("Mikrofon açılamadı: " + error.message);
      throw error;
    }
  }

  function stopMicrophone() {
    if (!localStream) return;

    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }

  function createPeer(peerId) {
    if (peers.has(peerId)) {
      return peers.get(peerId);
    }

    const pc = new RTCPeerConnection(rtcConfig);

    peers.set(peerId, pc);

    if (localStream) {
      localStream.getTracks().forEach(track => {
        pc.addTrack(track, localStream);
      });
    }

    pc.onicecandidate = event => {
      if (!event.candidate) return;

      socket.emit("voice:signal", {
        to: peerId,
        data: {
          candidate: event.candidate
        }
      });
    };

    pc.ontrack = event => {
      let audio = $("audio-" + peerId);

      if (!audio) {
        audio = document.createElement("audio");
        audio.id = "audio-" + peerId;
        audio.autoplay = true;
        audio.playsInline = true;

        $("voiceAudioContainer").appendChild(audio);
      }

      audio.srcObject = event.streams[0];
      audio.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        removePeer(peerId);
      }
    };

    return pc;
  }

  async function makeOffer(peerId) {
    const pc = createPeer(peerId);

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      socket.emit("voice:signal", {
        to: peerId,
        data: {
          description: pc.localDescription
        }
      });
    } catch (error) {
      console.error("Offer hatası:", error);
    }
  }

  async function handleSignal(packet) {
    if (!packet || !packet.from || !packet.data) return;

    const peerId = packet.from;
    const data = packet.data;

    const pc = createPeer(peerId);

    try {
      if (data.description) {
        const description = data.description;

        await pc.setRemoteDescription(
          new RTCSessionDescription(description)
        );

        if (description.type === "offer") {
          const answer = await pc.createAnswer();

          await pc.setLocalDescription(answer);

          socket.emit("voice:signal", {
            to: peerId,
            data: {
              description: pc.localDescription
            }
          });
        }
      }

      if (data.candidate) {
        await pc.addIceCandidate(
          new RTCIceCandidate(data.candidate)
        );
      }
    } catch (error) {
      console.error("WebRTC sinyal hatası:", error);
    }
  }

  function removePeer(peerId) {
    const pc = peers.get(peerId);

    if (pc) {
      pc.close();
      peers.delete(peerId);
    }

    const audio = $("audio-" + peerId);

    if (audio) {
      audio.srcObject = null;
      audio.remove();
    }
  }

  function renderUsers(list) {
    $("voiceRoomUsers").innerHTML = "";

    if (!Array.isArray(list)) return;

    list.forEach(user => {
      const item = document.createElement("div");
      item.className = "message";

      item.textContent =
        user.username + (user.isHost ? " (Oda sahibi)" : "");

      $("voiceRoomUsers").appendChild(item);
    });
  }

  // ODA OLUŞTUR
  $("voiceCreateButton").addEventListener("click", async () => {
    const roomName = $("voiceRoomNameInput").value.trim();

    try {
      await startMicrophone();

      socket.emit("voice:create", { roomName }, result => {
        if (!result || !result.ok) {
          setStatus(result?.error || "Oda oluşturulamadı.");
          return;
        }

        currentRoom = result.roomName;
        isHost = true;

        window.Chatbox.setVoiceRoom(currentRoom, true);

        $("voiceRoomTitle").textContent = currentRoom;
        setStatus("Oda oluşturuldu. Mikrofon açık.");

        window.Chatbox.playSound("joinSound");
      });
    } catch {}
  });

  // ODAYA KATIL
  $("voiceJoinButton").addEventListener("click", async () => {
    const roomName = $("voiceJoinRoomInput").value.trim();

    if (!roomName) {
      setStatus("Katılmak için oda adı yaz.");
      return;
    }

    try {
      await startMicrophone();

      socket.emit("voice:join", { roomName }, async result => {
        if (!result || !result.ok) {
          setStatus(result?.error || "Odaya katılınamadı.");
          return;
        }

        currentRoom = result.roomName;
        isHost = false;

        window.Chatbox.setVoiceRoom(currentRoom, false);

        $("voiceRoomTitle").textContent = currentRoom;
        setStatus("Odaya katıldın. Mikrofon açık.");

        window.Chatbox.playSound("joinSound");

        const otherPeers = result.peers || [];

        for (const peer of otherPeers) {
          await makeOffer(peer.id);
        }
      });
    } catch {}
  });

  // ODAYA KATILDI BİLDİRİMİ
  socket.on("voice:room-joined", async data => {
    if (!data) return;

    currentRoom = data.roomName;
    isHost = !!data.isHost;

    window.Chatbox.setVoiceRoom(currentRoom, isHost);

    $("voiceRoomTitle").textContent = currentRoom;
  });

  // YENİ KULLANICI GELDİ
  socket.on("voice:peer-joined", async data => {
    if (!data || !data.id) return;

    await makeOffer(data.id);
  });

  // WEBRTC SİNYALİ
  socket.on("voice:signal", handleSignal);

  // KULLANICI AYRILDI
  socket.on("voice:peer-left", data => {
    if (data?.id) {
      removePeer(data.id);
    }
  });

  // KULLANICILAR
  socket.on("voice:users", renderUsers);

  // MİKROFON
  $("voiceMuteButton").addEventListener("click", () => {
    if (!localStream) return;

    muted = !muted;

    localStream.getAudioTracks().forEach(track => {
      track.enabled = !muted;
    });

    $("voiceMuteButton").textContent =
      muted ? "Mikrofonu Aç" : "Mikrofonu Kapat";
  });

  // ODA SOHBETİ AÇ/KAPAT
  $("voiceChatToggleButton").addEventListener("click", () => {
    $("voiceChatPanel").classList.toggle("hidden");
  });

  // ODA MESAJI GÖNDER
  function sendVoiceMessage() {
    const input = $("voiceMessageInput");
    const text = input.value.trim();

    if (!text) return;

    socket.emit("voice:message", text);

    input.value = "";
  }

  $("voiceMessageSendButton").addEventListener(
    "click",
    sendVoiceMessage
  );

  $("voiceMessageInput").addEventListener("keydown", event => {
    if (event.key === "Enter") sendVoiceMessage();
  });

  // ODA MESAJLARI
  socket.on("voice:message", data => {
    const item = document.createElement("div");
    item.className = "message";

    const name = document.createElement("strong");
    name.textContent = data.username || "Kullanıcı";

    const text = document.createElement("span");
    text.textContent = data.text || "";

    item.append(name, text);

    $("voiceMessages").appendChild(item);
    $("voiceMessages").scrollTop =
      $("voiceMessages").scrollHeight;
  });

  // ODA KAPANDI
  socket.on("voice:room-closed", () => {
    currentRoom = "";
    isHost = false;

    clearPeers();
    stopMicrophone();

    window.Chatbox.setVoiceRoom("", false);
    window.Chatbox.showChat();

    window.Chatbox.playSound("leaveSound");
    setStatus("Oda kapandı.");
  });

  // ODA SAHİBİ DURUMU
  socket.on("voice:host-status", data => {
    if (!data) return;

    currentRoom = data.roomName || "";
    isHost = !!data.isHost;

    window.Chatbox.setVoiceRoom(currentRoom, isHost);
  });

  // AYRILMA
  $("voiceLeaveButton").addEventListener("click", () => {
    socket.emit("voice:leave");

    clearPeers();
    stopMicrophone();

    currentRoom = "";
    isHost = false;

    window.Chatbox.setVoiceRoom("", false);
    window.Chatbox.showChat();

    window.Chatbox.playSound("leaveSound");
  });
})();
