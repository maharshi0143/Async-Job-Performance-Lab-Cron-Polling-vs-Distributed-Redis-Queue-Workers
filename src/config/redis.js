const IORedis = require("ioredis");

const connection = new IORedis({
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 100, 3000),
});

connection.on("error", () => {});

module.exports = connection;