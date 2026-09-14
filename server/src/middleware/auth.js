const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'syncpad_super_secret_jwt_key_2026';

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, name: user.name, email: user.email },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) {
    return next(new Error('Authentication error: Token missing'));
  }

  try {
    const decoded = verifyToken(token);
    socket.user = decoded;
    next();
  } catch (err) {
    return next(new Error('Authentication error: Invalid token'));
  }
}

module.exports = {
  JWT_SECRET,
  generateToken,
  verifyToken,
  authMiddleware,
  socketAuthMiddleware
};
