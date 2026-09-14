const Redis = require('ioredis');

function createRedisClient() {
  const host = process.env.REDIS_HOST || 'localhost';
  const port = parseInt(process.env.REDIS_PORT || '6379', 10);
  const password = process.env.REDIS_PASSWORD || undefined;

  const client = new Redis({
    host,
    port,
    password,
    lazyConnect: true,
    retryStrategy(times) {
      if (times > 3) return null; // stop retrying after 3 attempts if local redis isn't running
      return Math.min(times * 200, 1000);
    }
  });

  client.on('error', (err) => {
    // Graceful error handle so local dev without Redis doesn't crash
  });

  return client;
}

module.exports = { createRedisClient };
