const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  },
  transports: ['websocket', 'polling']
});

app.use(cors());
app.use(express.static('public'));

const users = new Map();
const ROOM_ID = "MAIN_ROOM";

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  socket.join(ROOM_ID);
  
  socket.on('join', (userName) => {
    console.log(`${userName} joined`);
    users.set(socket.id, { name: userName, id: socket.id });
    
    const participants = Array.from(users.values()).map(u => ({
      id: u.id,
      name: u.name
    }));
    
    socket.emit('room-data', {
      participants: participants,
      yourId: socket.id,
      yourName: userName
    });
    
    socket.broadcast.emit('user-joined', {
      userId: socket.id,
      userName: userName
    });
  });
  
  socket.on('signal', (data) => {
    socket.to(data.target).emit('signal', {
      signal: data.signal,
      from: socket.id,
      fromName: users.get(socket.id)?.name
    });
  });
  
  socket.on('disconnect', () => {
    const user = users.get(socket.id);
    if (user) {
      users.delete(socket.id);
      socket.broadcast.emit('user-left', {
        userId: socket.id,
        userName: user.name
      });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
