const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));

const users = {};

io.on('connection', (socket) => {
  console.log('Connect:', socket.id);

  socket.on('join', ({ name }) => {
    socket.userName = name;
    users[socket.id] = { id: socket.id, name };
    
    socket.join('room1');
    
    // Отправляем всем в комнате о новом участнике
    socket.to('room1').emit('userJoined', { id: socket.id, name });
    
    // Отправляем новому список существующих
    const others = Object.values(users).filter(u => u.id !== socket.id);
    socket.emit('usersList', others);
    
    io.to('room1').emit('count', Object.keys(users).length);
    console.log(`${name} joined. Total: ${Object.keys(users).length}`);
  });

  socket.on('offer', (data) => {
    socket.to(data.to).emit('offer', { from: socket.id, offer: data.offer });
  });

  socket.on('answer', (data) => {
    socket.to(data.to).emit('answer', { from: socket.id, answer: data.answer });
  });

  socket.on('ice', (data) => {
    socket.to(data.to).emit('ice', { from: socket.id, ice: data.ice });
  });

  socket.on('disconnect', () => {
    delete users[socket.id];
    io.to('room1').emit('userLeft', { id: socket.id });
    io.to('room1').emit('count', Object.keys(users).length);
    console.log('Disconnect. Total:', Object.keys(users).length);
  });
});

server.listen(PORT, () => console.log('Server on', PORT));
