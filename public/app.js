const socket = io();

const joinScreen = document.getElementById("joinScreen");
const chatScreen = document.getElementById("chatScreen");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");

const messages = document.getElementById("messages");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");

const userList = document.getElementById("userList");
const onlineCount = document.getElementById("onlineCount");
const profileName = document.getElementById("profileName");
const profileAvatar = document.getElementById("profileAvatar");

const gifButton = document.getElementById("gifButton");
const gifModal = document.getElementById("gifModal");
const closeGif = document.getElementById("closeGif");
const gifSearchForm = document.getElementById("gifSearchForm");
const gifQuery = document.getElementById("gifQuery");
const gifResults = document.getElementById("gifResults");

let username = "";
let joined = false;

function showJoinScreen() {
    joinScreen.classList.remove("hidden");
    chatScreen.classList.add("hidden");
    chatScreen.style.display = "none";
}

function showChatScreen() {
    joinScreen.classList.add("hidden");
    chatScreen.classList.remove("hidden");
    chatScreen.style.display = "flex";
}

function escapeHTML(text) {
    return String(text).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function scrollMessages() {
    messages.scrollTop = messages.scrollHeight;
}

function addSystemMessage(text) {
    const item = document.createElement("div");
    item.className = "system-message";
    item.textContent = text;
    messages.appendChild(item);
    scrollMessages();
}

function addMessage(message) {
    const item = document.createElement("div");
    item.className = "message";

    if (message.userId === socket.id) {
        item.classList.add("own");
    }

    const name = document.createElement("div");
    name.className = "message-name";
    name.textContent = message.username || "Guest";

    const content = document.createElement("div");
    content.className = "message-content";

    if (message.type === "gif") {
        const image = document.createElement("img");
        image.src = message.url;
        image.alt = message.title || "GIF";
        image.loading = "lazy";
        image.className = "chat-gif";
        content.appendChild(image);
    } else {
        content.textContent = message.text || "";
    }

    const time = document.createElement("div");
    time.className = "message-time";
    time.textContent = new Date(message.time || Date.now())
        .toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit"
        });

    item.append(name, content, time);
    messages.appendChild(item);
    scrollMessages();
}

// Giriş
if (joinForm) {
    joinForm.addEventListener("submit", event => {
        event.preventDefault();

        username = nameInput.value.trim();

        if (!username) {
            nameInput.focus();
            return;
        }

        if (joined) return;
        joined = true;

        if (profileName) {
            profileName.textContent = username;
        }

        if (profileAvatar) {
            profileAvatar.textContent =
                username.charAt(0).toUpperCase();
        }

        showChatScreen();

        if (socket.connected) {
            socket.emit("join", username);
        } else {
            socket.once("connect", () => {
                socket.emit("join", username);
            });
        }

        messageInput?.focus();
    });
}

// Mesaj gönderme
if (messageForm) {
    messageForm.addEventListener("submit", event => {
        event.preventDefault();

        const text = messageInput.value.trim();

        if (!text || !joined) return;

        socket.emit("chat:message", {
            type: "text",
            text
        });

        messageInput.value = "";
        messageInput.focus();
    });
}

// Sunucudan mesaj gelmesi
socket.on("chat:message", addMessage);

socket.on("chat:history", history => {
    messages.innerHTML = "";
    history.forEach(addMessage);
});

socket.on("chat:system", data => {
    addSystemMessage(data.text);
});

// Çevrimiçi kullanıcılar
socket.on("users:update", users => {
    if (onlineCount) {
        onlineCount.textContent = users.length;
    }

    if (!userList) return;

    userList.innerHTML = "";

    users.forEach(user => {
        const item = document.createElement("div");
        item.className = "user-item";

        const avatar = document.createElement("span");
        avatar.className = "user-avatar";
        avatar.textContent = user.username.charAt(0).toUpperCase();

        const name = document.createElement("span");
        name.textContent = user.username;

        const status = document.createElement("span");
        status.className = "online-dot";

        item.append(avatar, name, status);
        userList.appendChild(item);
    });
});

// GIF penceresini aç
if (gifButton && gifModal) {
    gifButton.addEventListener("click", () => {
        gifModal.classList.remove("hidden");
        gifModal.removeAttribute("hidden");
        gifModal.style.display = "flex";

        gifQuery?.focus();

        searchGIFs("");
    });
}

// GIF penceresini kapat
function hideGIFModal() {
    if (!gifModal) return;

    gifModal.classList.add("hidden");
    gifModal.style.display = "none";
    gifModal.setAttribute("hidden", "");
}

closeGif?.addEventListener("click", hideGIFModal);

// GIF arama
async function searchGIFs(query) {
    if (!gifResults) return;

    gifResults.innerHTML = "<p>GIF aranıyor...</p>";

    try {
        const response = await fetch(
            "/api/gifs?q=" + encodeURIComponent(query)
        );

        if (!response.ok) {
            throw new Error("GIF API hatası");
        }

        const data = await response.json();

        gifResults.innerHTML = "";

        if (!data.gifs || data.gifs.length === 0) {
            gifResults.innerHTML = "<p>GIF bulunamadı.</p>";
            return;
        }

        data.gifs.forEach(gif => {
            const button = document.createElement("button");
            button.className = "gif-result";

            const image = document.createElement("img");
            image.src = gif.preview;
            image.alt = gif.title || "GIF";

            button.appendChild(image);

            button.addEventListener("click", () => {
                socket.emit("chat:message", {
                    type: "gif",
                    url: gif.url,
                    title: gif.title
                });

                hideGIFModal();
            });

            gifResults.appendChild(button);
        });
    } catch (error) {
        gifResults.innerHTML =
            "<p>GIF yüklenemedi. API anahtarını kontrol et.</p>";
    }
}

if (gifSearchForm) {
    gifSearchForm.addEventListener("submit", event => {
        event.preventDefault();
        searchGIFs(gifQuery.value.trim());
    });
}

// Başlangıçta yalnızca giriş ekranı
showJoinScreen();
