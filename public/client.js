let socket;
let localStream;
let peers = new Map();
let currentUserName = null;
let myId = null;

const loginScreen = document.getElementById('loginScreen');
const chatScreen = document.getElementById('chatScreen');
const videoGrid = document.getElementById('videoGrid');
const participantCountSpan = document.getElementById('participantCount');
const currentRoomIdSpan = document.getElementById('currentRoomId');

window.onload = () => {
    socket = io();
    setupSocketListeners();
};

function setupSocketListeners() {
    socket.on('connect', () => {
        console.log('Connected to server');
    });
    
    socket.on('room-data', (data) => {
        console.log('Room data:', data);
        myId = data.yourId;
        currentRoomIdSpan.textContent = 'Main Room';
        loginScreen.style.display = 'none';
        chatScreen.style.display = 'block';
        
        // Добавляем существующих участников
        data.participants.forEach(participant => {
            if (participant.id !== myId) {
                addRemoteVideo(participant.id, participant.name);
            }
        });
        
        startLocalStream();
    });
    
    socket.on('user-joined', (data) => {
        console.log('User joined:', data.userName);
        addRemoteVideo(data.userId, data.userName);
    });
    
    socket.on('user-left', (data) => {
        console.log('User left:', data.userName);
        removeRemoteVideo(data.userId);
    });
    
    socket.on('offer', async (data) => {
        console.log('Offer from:', data.fromName);
        if (!peers.has(data.from)) {
            const pc = createPeerConnection(data.from);
            peers.set(data.from, pc);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('answer', { target: data.from, answer });
        }
    });
    
    socket.on('answer', async (data) => {
        const pc = peers.get(data.from);
        if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
        }
    });
    
    socket.on('ice-candidate', (data) => {
        const pc = peers.get(data.from);
        if (pc) {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        }
    });
}

async function startLocalStream() {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        addLocalVideo();
        updateCount();
    } catch (error) {
        console.error(error);
        alert('Need camera and microphone access');
    }
}

function addLocalVideo() {
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${myId}`;
    
    const video = document.createElement('video');
    video.srcObject = localStream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'username';
    nameDiv.textContent = `${currentUserName} (You)`;
    
    container.appendChild(video);
    container.appendChild(nameDiv);
    videoGrid.appendChild(container);
}

function createPeerConnection(targetId) {
    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' }
        ]
    });
    
    if (localStream) {
        localStream.getTracks().forEach(track => {
            pc.addTrack(track, localStream);
        });
    }
    
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            socket.emit('ice-candidate', { target: targetId, candidate: event.candidate });
        }
    };
    
    pc.ontrack = (event) => {
        const container = document.getElementById(`video-${targetId}`);
        if (container) {
            const video = container.querySelector('video');
            if (video && !video.srcObject) {
                video.srcObject = event.streams[0];
                video.autoplay = true;
            }
        }
    };
    
    return pc;
}

function addRemoteVideo(userId, userName) {
    if (userId === myId) return;
    if (document.getElementById(`video-${userId}`)) return;
    
    console.log('Adding remote:', userName);
    
    const container = document.createElement('div');
    container.className = 'video-container';
    container.id = `video-${userId}`;
    
    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    
    const nameDiv = document.createElement('div');
    nameDiv.className = 'username';
    nameDiv.textContent = userName;
    
    container.appendChild(video);
    container.appendChild(nameDiv);
    videoGrid.appendChild(container);
    
    const pc = createPeerConnection(userId);
    peers.set(userId, pc);
    
    pc.createOffer()
        .then(offer => pc.setLocalDescription(offer))
        .then(() => {
            socket.emit('offer', { target: userId, offer: pc.localDescription });
        })
        .catch(console.error);
    
    updateCount();
}

function removeRemoteVideo(userId) {
    const container = document.getElementById(`video-${userId}`);
    if (container) container.remove();
    
    const pc = peers.get(userId);
    if (pc) {
        pc.close();
        peers.delete(userId);
    }
    
    updateCount();
}

function updateCount() {
    const count = document.querySelectorAll('.video-container').length;
    participantCountSpan.textContent = count;
}

function join() {
    const name = document.getElementById('userName').value.trim();
    if (!name) {
        alert('Enter your name');
        return;
    }
    currentUserName = name;
    socket.emit('join', name);
}

function leave() {
    if (localStream) {
        localStream.getTracks().forEach(t => t.stop());
    }
    peers.forEach(pc => pc.close());
    peers.clear();
    videoGrid.innerHTML = '';
    loginScreen.style.display = 'flex';
    chatScreen.style.display = 'none';
    document.getElementById('userName').value = '';
}

function toggleAudio() {
    const track = localStream?.getAudioTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        document.getElementById('audioBtn').textContent = track.enabled ? '🎤 Mute' : '🔇 Unmute';
    }
}

function toggleVideo() {
    const track = localStream?.getVideoTracks()[0];
    if (track) {
        track.enabled = !track.enabled;
        document.getElementById('videoBtn').textContent = track.enabled ? '📹 Stop' : '📹 Start';
    }
}

async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
        const videoTrack = screenStream.getVideoTracks()[0];
        const oldTrack = localStream.getVideoTracks()[0];
        
        localStream.removeTrack(oldTrack);
        localStream.addTrack(videoTrack);
        
        const localVideo = document.querySelector(`#video-${myId} video`);
        if (localVideo) localVideo.srcObject = localStream;
        
        peers.forEach(pc => {
            const sender = pc.getSenders().find(s => s.track?.kind === 'video');
            if (sender) sender.replaceTrack(videoTrack);
        });
        
        videoTrack.onended = () => {
            navigator.mediaDevices.getUserMedia({ video: true })
                .then(stream => {
                    const newTrack = stream.getVideoTracks()[0];
                    localStream.removeTrack(videoTrack);
                    localStream.addTrack(newTrack);
                    peers.forEach(pc => {
                        const sender = pc.getSenders().find(s => s.track?.kind === 'video');
                        if (sender) sender.replaceTrack(newTrack);
                    });
                });
        };
    } catch (err) {
        console.error(err);
    }
}

function copyLink() {
    navigator.clipboard.writeText(window.location.href);
    alert('Link copied!');
}
