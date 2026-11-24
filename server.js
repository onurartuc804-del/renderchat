const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3000;
app.use(express.static("public"));
const history = [], users = new Map(), voiceRooms = new Map();
const MAX_HISTORY = 100, GIF_LIMIT = 50;
app.get("/api/gifs", async (req, res) => {
  const apiKey = process.env.GIPHY_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "GIPHY_API_KEY ayarlanmamış." });
  const query = String(req.query.q || "").trim().slice(0, 100);
  const offset = Math.max(0, Math.min(parseInt(req.query.offset || "0", 10) || 0, 4999));
  try {
    const endpoint = query ? "https://api.giphy.com/v1/gifs/search" : "https://api.giphy.com/v1/gifs/trending";
    const params = new URLSearchParams({ api_key: apiKey, limit: String(GIF_LIMIT), offset: String(offset), rating: "pg" });
    if (query) params.set("q", query);
    const response = await fetch(`${endpoint}?${params}`);
    if (!response.ok) return res.status(502).json({ error: "GIPHY isteği başarısız." });
    const result = await response.json();
    const gifs = (result.data || []).map(gif => {
      const images = gif.images || {};
      return { id: gif.id, title: gif.title || "GIF", preview: images.fixed_width_small?.url || images.fixed_width?.url, url: images.original?.url || images.fixed_width?.url };
    }).filter(gif => gif.preview && gif.url);
    res.json({ gifs, nextOffset: offset + GIF_LIMIT, total: Number(result.pagination?.total_count || 0) });
  } catch (error) { console.error("GIF error:", error); res.status(500).json({ error: "GIF yüklenemedi." }); }
});
function cleanText(value, maxLength = 500) { return String(value || "").replace(/[<>]/g, "").trim().slice(0, maxLength); }
function validGifUrl(value) { try { const url = new URL(String(value)); return url.protocol === "https:" && /^media\d*\.giphy\.com$/i.test(url.hostname); } catch { return false; } }
function broadcastUsers() { io.emit("users:update", Array.from(users.entries()).map(([id, username]) => ({ id, username }))); }
function publicRoom(room) { return { id: room.id, hostName: room.hostName, members: Array.from(room.members).map(id => ({ id, username: users.get(id) || "Guest" })) }; }
function sendRoomUpdate(room) { const data = { roomId: room.id, members: publicRoom(room).members }; room.members.forEach(id => io.to(id).emit("voice:room:update", data)); }
function removeFromVoice(socket, announce = true) {
  const roomId = socket.data.voiceRoomId;
  if (!roomId) return;
  const room = voiceRooms.get(roomId);
  socket.data.voiceRoomId = null;
  if (!room) return;
  room.members.delete(socket.id);
  if (announce) room.members.forEach(id => io.to(id).emit("voice:member:left", { roomId, id: socket.id, username: users.get(socket.id) || "Kullanıcı" }));
  if (room.members.size === 0) voiceRooms.delete(roomId); else sendRoomUpdate(room);
}
io.on("connection", socket => {
  socket.on("join", rawName => {
    if (users.has(socket.id)) return;
    const username = cleanText(rawName, 24) || "Guest";
    users.set(socket.id, username);
    socket.emit("chat:history", history);
    broadcastUsers();
    io.emit("chat:system", { text: `${username} sohbete katıldı.`, time: Date.now() });
  });
  socket.on("chat:message", raw => {
    const username = users.get(socket.id);
    if (!username || !raw || typeof raw !== "object") return;
    const type = raw.type === "gif" ? "gif" : "text";
    let message;
    if (type === "gif") {
      const url = String(raw.url || ""); if (!validGifUrl(url)) return;
      message = { id: `${socket.id}-${Date.now()}`, userId: socket.id, username, type, url, title: cleanText(raw.title, 100), time: Date.now() };
    } else {
      const text = cleanText(raw.text, 1000); if (!text) return;
      message = { id: `${socket.id}-${Date.now()}`, userId: socket.id, username, type, text, time: Date.now() };
    }
    history.push(message); if (history.length > MAX_HISTORY) history.shift(); io.emit("chat:message", message);
  });
  socket.on("voice:room:create", (_, callback) => {
    if (!users.has(socket.id)) return callback?.({ ok: false, error: "Önce Chatbox'a giriş yap." });
    if (socket.data.voiceRoomId) return callback?.({ ok: false, error: "Zaten bir odadasın." });
    const roomId = `voice-${socket.id}`;
    const room = { id: roomId, hostId: socket.id, hostName: users.get(socket.id), members: new Set([socket.id]) };
    voiceRooms.set(roomId, room); socket.data.voiceRoomId = roomId;
    callback?.({ ok: true, room: publicRoom(room) });
  });
  socket.on("voice:room:join", (payload, callback) => {
    if (!users.has(socket.id)) return callback?.({ ok: false, error: "Önce Chatbox'a giriş yap." });
    if (socket.data.voiceRoomId) return callback?.({ ok: false, error: "Önce bulunduğun odadan çık." });
    const hostName = cleanText(payload?.hostName, 24).toLowerCase();
    const room = Array.from(voiceRooms.values()).find(item => item.hostName.toLowerCase() === hostName);
    if (!room) return callback?.({ ok: false, error: "Bu kullanıcı adına ait açık bir oda bulunamadı." });
    if (room.members.size >= 8) return callback?.({ ok: false, error: "Oda dolu (en fazla 8 kişi)." });
    room.members.add(socket.id); socket.data.voiceRoomId = room.id;
    sendRoomUpdate(room);
    callback?.({ ok: true, room: publicRoom(room) });
  });
  socket.on("voice:signal", payload => {
    const room = voiceRooms.get(socket.data.voiceRoomId);
    if (!room || !room.members.has(payload?.to) || !payload?.signal) return;
    io.to(payload.to).emit("voice:signal", { from: socket.id, signal: payload.signal });
  });
  socket.on("voice:room:chat", payload => {
    const room = voiceRooms.get(socket.data.voiceRoomId), text = cleanText(payload?.text, 500);
    if (!room || !text) return;
    const message = { roomId: room.id, username: users.get(socket.id) || "Guest", text, time: Date.now() };
    room.members.forEach(id => io.to(id).emit("voice:room:chat", message));
  });
  socket.on("voice:room:leave", () => removeFromVoice(socket));
  socket.on("disconnect", () => {
    removeFromVoice(socket);
    const username = users.get(socket.id); if (!username) return;
    users.delete(socket.id); broadcastUsers();
    io.emit("chat:system", { text: `${username} sohbetten ayrıldı.`, time: Date.now() });
  });
});
server.listen(PORT, () => console.log(`Chatbox running on port ${PORT}`));
