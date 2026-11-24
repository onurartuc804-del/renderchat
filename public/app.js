const joinScreen = document.getElementById("joinScreen");
const chatScreen = document.getElementById("chatScreen");
const joinForm = document.getElementById("joinForm");
const nameInput = document.getElementById("nameInput");

let username = "";
let joined = false;

joinForm.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();

    if (!name) {
        nameInput.focus();
        return;
    }

    if (joined) return;

    username = name;
    joined = true;

    // Kullanıcı adını kaydet
    localStorage.setItem("chatbox_username", username);

    // Profil bilgileri
    const profileName = document.getElementById("profileName");
    const profileAvatar = document.getElementById("profileAvatar");

    if (profileName) profileName.textContent = username;
    if (profileAvatar) {
        profileAvatar.textContent = username.charAt(0).toUpperCase();
    }

    // Kaydetme ekranını kapat
    joinScreen.classList.add("hidden");
    joinScreen.style.display = "none";

    // Sohbet ekranını aç
    chatScreen.classList.remove("hidden");
    chatScreen.style.display = "flex";

    // Sunucuya katıl
    socket.emit("join", username);
});

// Sayfa yeniden açıldığında kayıtlı ismi kullan
const savedName = localStorage.getItem("chatbox_username");

if (savedName) {
    nameInput.value = savedName;
}
