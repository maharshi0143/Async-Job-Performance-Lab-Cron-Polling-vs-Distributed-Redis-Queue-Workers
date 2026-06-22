const prisma = require('../config/prisma');
const exportQueue = require("../queues/export.queue");

async function addToQueueWithTimeout(jobData, opts, ms = 5000) {
    return Promise.race([
        exportQueue.add("generate-report", jobData, opts),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Redis queue add timed out")), ms)
        )
    ]);
}

// Create an Export Job
async function createExportJob(data){
    const job = await prisma.job.create({
        data:{
            user_id: data.user_id,
            type: data.type,
            priority: data.priority || 10,
            status:"PENDING",
            submitted_at: BigInt(Date.now()),
        }
    });

    try {
        await addToQueueWithTimeout(
            { jobId: job.id },
            {
                priority: job.priority,
                attempts: 4,
                backoff: {
                    type: "exponential",
                    delay: 5000
                }
            }
        );
    } catch (err) {
        console.warn("Queue add failed (Redis may be down):", err.message);
    }

    return job;
}



module.exports = {
    createExportJob
};