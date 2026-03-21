const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

const users = {};

io.on('connection', (socket) => {
  console.log(`✅ Подключился: ${socket.id}`);

  socket.on('join-room', (data) => {
    const userName = data.userName || 'User';
    const roomId = 'MAIN-ROOM';
    
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = userName;
    
    users[socket.id] = { id: socket.id, name: userName, roomId };
    
    console.log(`📍 ${userName} (${socket.id}) вошёл`);
    console.log(`Всего: ${Object.keys(users).length}`);
    
    // Отправляем новому пользователю список остальных
    const otherUsers = Object.values(users).filter(u => u.id !== socket.id);
    console.log(`Отправляю ${socket.id} список: ${otherUsers.length} чел.`);
    socket.emit('room-users', otherUsers);
    
    // Сообщаем ВСЕМ в комнате о новом участнике
    io.to(roomId).emit('user-joined', { id: socket.id, name: userName });
    
    // Обновляем счётчик
    io.to(roomId).emit('update-count', Object.keys(users).length);
  });

  socket.on('offer', (data) => {
    socket.to(data.targetId).emit('offer', { senderId: socket.id, offer: data.offer });
  });

  socket.on('answer', (data) => {
    socket.to(data.targetId).emit('answer', { senderId: socket.id, answer: data.answer });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetId).emit('ice-candidate', { senderId: socket.id, candidate: data.candidate });
  });

  socket.on('disconnect', () => {
    console.log(`❌ Отключился: ${socket.id}`);
    if (users[socket.id]) {
      const roomId = users[socket.id].roomId;
      const name = users[socket.id].name;
      delete users[socket.id];
      
      io.to(roomId).emit('user-left', { id: socket.id });
      io.to(roomId).emit('update-count', Object.keys(users).length);
      console.log(`${name} вышел. Осталось: ${Object.keys(users).length}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Сервер на порту ${PORT}`);
});
