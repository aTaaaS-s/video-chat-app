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
  
  socket.on('join', (userName) => {
    users[socket.id] = { id: socket.id, name: userName };
    socket.userName = userName;
    
    console.log(`${userName} joined`);
    
    // Отправляем новому список остальных
    const others = Object.values(users).filter(u => u.id !== socket.id);
    socket.emit('usersList', others);
    
    // Сообщаем всем о новом
    socket.broadcast.emit('userJoined', { id: socket.id, name: userName });
    
    // Обновляем счётчик
    io.emit('count', Object.keys(users).length);
  });

  // Ретрансляция WebRTC данных
  socket.on('offer', (data) => {
    io.to(data.to).emit('offer', { from: socket.id, offer: data.offer });
  });

  socket.on('answer', (data) => {
    io.to(data.to).emit('answer', { from: socket.id, answer: data.answer });
  });

  socket.on('ice', (data) => {
    io.to(data.to).emit('ice', { from: socket.id, ice: data.ice });
  });

  socket.on('disconnect', () => {
    console.log('❌ Disconnect:', socket.id);
    delete users[socket.id];
    io.emit('userLeft', { id: socket.id });
    io.emit('count', Object.keys(users).length);
  });
});

server.listen(PORT, () => {
  console.log(`🚀 Server on port ${PORT}`);
});
