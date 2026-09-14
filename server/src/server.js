require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');

const { connectMongoDB, initPostgresSchema } = require('./config/db');
const { createRedisClient } = require('./config/redis');
const { socketAuthMiddleware } = require('./middleware/auth');
const authRoutes = require('./routes/auth');
const workspaceRoutes = require('./routes/workspaces');
const noteRoutes = require('./routes/notes');
const setupSocketHandlers = require('./sockets/otSocketHandler');

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors());
app.use(express.json());

// REST Routes
app.use('/api/auth', authRoutes);
app.use('/api/workspaces', workspaceRoutes);
app.use('/api/notes', noteRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'SyncPad OT Server', timestamp: new Date() });
});

// Socket.IO Server Setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE']
  }
});

app.set('io', io);

// Redis Adapter Scaling (Optional / Conditioned)
if (process.env.USE_REDIS === 'true') {
  try {
    const pubClient = createRedisClient();
    const subClient = pubClient.duplicate();
    io.adapter(createAdapter(pubClient, subClient));
    console.log('[Redis] Socket.IO Redis Adapter configured successfully.');
  } catch (err) {
    console.warn('[Redis Adapter Warning] Redis unavailable, using standard memory adapter.');
  }
}

// Socket Authentication Middleware
io.use(socketAuthMiddleware);

// Socket Event Handlers
setupSocketHandlers(io);

// Initialize DB Connections and Start Server
const PORT = process.env.PORT || 5000;

async function startServer() {
  await connectMongoDB();
  await initPostgresSchema();

  server.listen(PORT, () => {
    console.log(`=================================================`);
    console.log(` SyncPad OT Server listening on port ${PORT}`);
    console.log(` Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`=================================================`);
  });
}

startServer().catch((err) => {
  console.error('[Fatal Error] Failed to start server:', err);
  process.exit(1);
});

module.exports = { app, server, io };
