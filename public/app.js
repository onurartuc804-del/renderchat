(() => {
  const socket = io();

  window.chatboxSocket = socket;

  const $ = id => document.getElementById(id);

  const joinScreen = $("joinScreen");
  const chatScreen = $("chatScreen");
  const joinForm = $("joinForm");
  const nameInput = $("nameInput");

  const messages = $("messages");
  const messageForm = $("messageForm");
  const messageInput = $("messageInput");

  const userList = $("userList");
  const onlineCount = $("onlineCount");

  const gifButton = $("gifButton");
  const gifModal = $("gifModal");
  const closeGif = $("closeGif");
  const gifSearchForm = $("gifSearchForm");
  const gifQuery = $("gifQuery");
  const gifResults = $("gifResults");

  let username = "";

  window.chatboxUsername = "";

  joinForm.addEventListener("submit", event => {
    event.preventDefault();

    const name = nameInput.value.trim().slice(0, 24);
    if (!name) return;

    username = name;
    window.chatboxUsername = name;

    socket.emit("user:join", name);

    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");

    messageInput.focus();
  });

  messageForm.addEventListener("submit", event => {
    event.preventDefault();

    const text = messageInput.value.trim();
    if (!text) return;

    socket.emit("chat:message", text);
    messageInput.value = "";
  });

  function addMessage(data) {
    const item = document.createElement("div");
    item.className = "message";

    const name = document.createElement("strong");
    name.textContent = data.username || "Kullanıcı";

    const text = document.createElement("span");
    text.textContent = data.text || "";

    const time = document.createElement("small");
    time.textContent = new Date(data.time || Date.now())
      .toLocaleTimeString("tr-TR", {
        hour: "2-digit",
        minute: "2-digit"
      });

    item.append(name, text, time);
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
  }

  socket.on("chat:history", history => {
    messages.innerHTML = "";
    (history || []).forEach(addMessage);
  });

  socket.on("chat:message", addMessage);

  socket.on("users:update", users => {
    userList.innerHTML = "";
    onlineCount.textContent = users.length;

    users.forEach(name => {
      const li = document.createElement("li");
      li.textContent = name;
      userList.appendChild(li);
    });
  });

  gifButton.addEventListener("click", () => {
    gifModal.classList.remove("hidden");
    gifQuery.focus();
  });

  closeGif.addEventListener("click", () => {
    gifModal.classList.add("hidden");
  });

  gifModal.addEventListener("click", event => {
    if (event.target === gifModal) {
      gifModal.classList.add("hidden");
    }
  });

  gifSearchForm.addEventListener("submit", async event => {
    event.preventDefault();

    const query = gifQuery.value.trim();
    if (!query) return;

    gifResults.innerHTML = "<p>GIF aranıyor...</p>";

    try {
      const response = await fetch(
        "/api/gifs?q=" + encodeURIComponent(query)
      );

      const gifs = await response.json();

      if (!response.ok) {
        throw new Error(gifs.error || "GIF araması başarısız.");
      }

      gifResults.innerHTML = "";

      gifs.forEach(gif => {
        const img = document.createElement("img");
        img.src = gif.preview || gif.url;
        img.alt = gif.title || "GIF";
        img.loading = "lazy";

        img.addEventListener("click", () => {
          socket.emit("chat:message", gif.url);
          gifModal.classList.add("hidden");
        });

        gifResults.appendChild(img);
      });

      if (!gifs.length) {
        gifResults.innerHTML = "<p>GIF bulunamadı.</p>";
      }
    } catch (error) {
      gifResults.innerHTML = "";
      const p = document.createElement("p");
      p.textContent = error.message;
      gifResults.appendChild(p);
    }
  });
})();
