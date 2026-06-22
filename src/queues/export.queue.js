const { Queue } = require("bullmq");

const connection = require("../config/redis");

const exportQueue = new Queue("exportQueue", { connection });

module.exports = exportQueue;