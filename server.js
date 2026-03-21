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
  console.log('✅ Connect:', socket.id);
  
  // Добавляем пользователя
  socket.on('join', (userName) => {
    users[socket.id] = { id: socket.id, name: userName };
    socket.userName = userName;
    
    console.log(`📝 ${userName} (${socket.id}) присоединился`);
    console.log(`Всего пользователей: ${Object.keys(users).length}`);
    
    // Отправляем НОВОМУ список ВСЕХ остальных
    const others = Object.values(users).filter(u => u.id !== socket.id);
    socket.emit('usersList', others);
    
    // Сообщаем ВСЕМ (включая нового) о новом участнике
    io.emit('userJoined', { id: socket.id, name: userName });
    
    // Обновляем счётчик ВСЕМ
    io.emit('count', Object.keys(users).length);
  });

  // WebRTC сигнализация - отправляем КОНКРЕТНОМУ пользователю
  socket.on('offer', (data) => {
    console.log(`📤 Offer: ${socket.id} -> ${data.to}`);
    io.to(data.to).emit('offer', { from: socket.id, offer: data.offer });
  });

  socket.on('answer', (data) => {
    console.log(`📤 Answer: ${socket.id} -> ${data.to}`);
    io.to(data.to).emit('answer', { from: socket.id, answer: data.answer });
  });

  socket.on('ice', (data) => {
    io.to(data.to).emit('ice', { from: socket.id, ice: data.ice });
  });

  // Выход
  socket.on('disconnect', () => {
    console.log('❌ Disconnect:', socket.id);
    if (users[socket.id]) {
      const name = users[socket.id].name;
      delete users[socket.id];
      
      io.emit('userLeft', { id: socket.id });
      io.emit('count', Object.keys(users).length);
      console.log(`${name} вышел. Осталось: ${Object.keys(users).length}`);
    }
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
