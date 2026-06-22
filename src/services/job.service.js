const prisma = require('../config/prisma');

async function createJob(data = {}){
    const job = await prisma.job.create({
        data:{
            type: data.type || "CRON",
            priority: data.priority || 10,
            status:"PENDING",
            submitted_at: BigInt(Date.now()),
            user_id: data.user_id || null,
        }
    });
    return job;
}

module.exports = {
    createJob
};