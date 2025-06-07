const socket = io();

const createBtn = document.getElementById("createSessionBtn");
const joinBtn = document.getElementById("joinSessionBtn");
const sessionInput = document.getElementById("sessionCodeInput");
const sessionDisplay = document.getElementById("sessionCodeDisplay");
const sessionSetup = document.getElementById("sessionSetup");
const chatRoom = document.getElementById("chatRoom");
const chatMessages = document.getElementById("chatMessages");
const messageInput = document.getElementById("messageInput");
const sendMessageBtn = document.getElementById("sendMessageBtn");
const fileInput = document.getElementById("fileInput");
const fileName = document.getElementById("fileName");
const sendFileBtn = document.getElementById("sendFileBtn");
const connectionStatus = document.getElementById("connectionStatus");
const sessionTimer = document.getElementById("sessionTimer").querySelector("span");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");

let currentSession = null;
let countdown = 600;  // 10 minutes
let timerInterval = null;

let localStream = null;
let peerConnection = null;
let isAudioEnabled = true;
let isVideoEnabled = true;
let peerReady = false;

const config = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }]
};

createBtn.onclick = () => socket.emit("create_session");

joinBtn.onclick = () => {
  const code = sessionInput.value.trim().toUpperCase();
  if (!code) return alert("Please enter a session code.");
  socket.emit("join_session", { session_id: code });
};

sendMessageBtn.onclick = sendChatMessage;
messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendChatMessage();
});

function sendChatMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentSession) return;
  socket.emit("send_message", { session_id: currentSession, message: text });
  addMessage("You", text);
  messageInput.value = "";
}

sendFileBtn.onclick = () => {
  if (!currentSession) return alert("Not in a session.");
  const file = fileInput.files[0];
  if (!file) return alert("No file selected.");
  const reader = new FileReader();
  reader.onload = () => {
    const b64 = reader.result.split(",")[1];
    socket.emit("send_file", {
      session_id: currentSession,
      filename: file.name,
      file: b64
    });
    const link = `<a href="/uploads/${file.name}" class="underline text-blue-400" target="_blank">${file.name}</a>`;
    addMessage("You", `Sent file: ${link}`);
  };
  reader.readAsDataURL(file);
};

fileInput.onchange = () => {
  fileName.textContent = fileInput.files[0]?.name || "Select file to share";
};

socket.on("session_created", (sessionId) => {
  sessionInput.value = sessionId;
  addMessage("System", `Session created. Share code: ${sessionId}`);
  startChatUI(sessionId);
});

socket.on("session_joined", (sessionId) => {
  addMessage("System", `Joined session: ${sessionId}`);
  startChatUI(sessionId);
});

socket.on("peer_ready", async () => {
  peerReady = true;
  if (localStream) startCall();
});

socket.on("receive_message", (msg) => addMessage("Peer", msg));

socket.on("receive_file", (data) => {
  const link = `<a href="${data.url}" class="underline text-green-400" target="_blank">${data.filename}</a>`;
  addMessage("Peer", `Sent file: ${link}`);
});

socket.on("signal", async ({ data }) => {
  if (!peerConnection) createPeerConnection();

  if (data.type === "offer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit("signal", { session_id: currentSession, data: { type: "answer", sdp: answer } });
  } else if (data.type === "answer") {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data.sdp));
  } else if (data.type === "ice") {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
  }
});

socket.on("error", (msg) => alert(msg));

function startChatUI(code) {
  currentSession = code;
  sessionDisplay.textContent = code;
  sessionSetup.classList.add("hidden");
  chatRoom.classList.remove("hidden");
  connectionStatus.textContent = `Connected to session ${code}`;
  timerInterval = setInterval(updateTimer, 1000);
  updateTimer();
  document.getElementById("toggleAudioBtn").onclick = toggleAudio;
  document.getElementById("toggleVideoBtn").onclick = toggleVideo;
  document.getElementById("endSessionBtn").onclick = handleEndSession;
  initMedia();
}

function updateTimer() {
  const mins = Math.floor(countdown / 60);
  const secs = countdown % 60;
  sessionTimer.textContent = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  if (countdown-- <= 0) {
    clearInterval(timerInterval);
    endSession();
  }
}

function addMessage(sender, msgHTML) {
  const el = document.createElement("div");
  el.classList.add("mb-2");
  el.innerHTML = `<strong>${sender}:</strong> ${msgHTML}`;
  chatMessages.appendChild(el);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function initMedia() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    localVideo.srcObject = localStream;
    if (peerReady) startCall();
  } catch (err) {
    connectionStatus.innerHTML = `<span class="text-red-400">Camera/Mic error: ${err.message}</span>`;
  }
}

function createPeerConnection() {
  peerConnection = new RTCPeerConnection(config);

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit("signal", {
        session_id: currentSession,
        data: { type: "ice", candidate: event.candidate }
      });
    }
  };

  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
  };

  if (localStream) {
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  }
}

function startCall() {
  createPeerConnection();
  peerConnection.createOffer()
    .then(offer => peerConnection.setLocalDescription(offer))
    .then(() => {
      socket.emit("signal", {
        session_id: currentSession,
        data: { type: "offer", sdp: peerConnection.localDescription }
      });
    });
}

function toggleAudio() {
  if (!localStream) return;
  isAudioEnabled = !isAudioEnabled;
  localStream.getAudioTracks().forEach(track => track.enabled = isAudioEnabled);
  document.getElementById("toggleAudioBtn").textContent = isAudioEnabled ? "Mute Audio" : "Unmute Audio";
}

function toggleVideo() {
  if (!localStream) return;
  isVideoEnabled = !isVideoEnabled;
  localStream.getVideoTracks().forEach(track => track.enabled = isVideoEnabled);
  document.getElementById("toggleVideoBtn").textContent = isVideoEnabled ? "Hide Video" : "Show Video";
}

function handleEndSession() {
  if (confirm("End this session?")) endSession();
}

function endSession() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
  }
  socket.disconnect();
  chatRoom.classList.add("hidden");
  document.getElementById("sessionEnded").classList.remove("hidden");
  connectionStatus.innerHTML = `<i class="fas fa-bolt text-red-500"></i> Session Ended`;
  clearInterval(timerInterval);
}
