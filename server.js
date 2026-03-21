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

const users = {}; // Все пользователи

io.on('connection', (socket) => {
  console.log(`✅ Подключился: ${socket.id}`);

  // Вход в комнату
  socket.on('join-room', (data) => {
    const roomId = 'MAIN-ROOM';
    socket.join(roomId);
    socket.roomId = roomId;
    socket.userName = data.userName || 'User';
    
    // Сохраняем пользователя
    users[socket.id] = {
      id: socket.id,
      name: socket.userName,
      roomId: roomId
    };
    
    console.log(`📍 ${socket.userName} (${socket.id}) вошёл в ${roomId}`);
    console.log(`Всего пользователей: ${Object.keys(users).length}`);
    
    // Отправляем новому пользователю список ВСЕХ остальных
    const otherUsers = Object.values(users).filter(u => u.id !== socket.id);
    console.log(`Отправляю ${socket.id} список: ${otherUsers.length} пользователей`);
    socket.emit('room-users', otherUsers);
    
    // Сообщаем ВСЕМ (включая нового) о новом участнике
    io.to(roomId).emit('user-joined', {
      id: socket.id,
      name: socket.userName
    });
    console.log(`Отправлено user-joined всем в комнате`);
    
    // Обновляем счётчик
    io.to(roomId).emit('update-count', Object.keys(users).length);
  });

  // WebRTC сигнализация
  socket.on('offer', (data) => {
    console.log(`📤 Offer: ${socket.id} -> ${data.targetId}`);
    socket.to(data.targetId).emit('offer', {
      senderId: socket.id,
      offer: data.offer
    });
  });

  socket.on('answer', (data) => {
    console.log(`📤 Answer: ${socket.id} -> ${data.targetId}`);
    socket.to(data.targetId).emit('answer', {
      senderId: socket.id,
      answer: data.answer
    });
  });

  socket.on('ice-candidate', (data) => {
    socket.to(data.targetId).emit('ice-candidate', {
      senderId: socket.id,
      candidate: data.candidate
    });
  });

  // Выход
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
