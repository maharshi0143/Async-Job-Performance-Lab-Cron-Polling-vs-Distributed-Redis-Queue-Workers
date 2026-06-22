require("dotenv").config();

const { Worker } = require("bullmq");

const connection = require("../config/redis");
const prisma = require("../config/prisma");

const worker = new Worker(
    "exportQueue",
    async (job) => {
        const now = Date.now();

        console.log(`[Attempt ${job.attemptsMade + 1}] Started:`, job.data.jobId);

        await prisma.job.update({
            where: { id: job.data.jobId },
            data: {
                status: "ACTIVE",
                started_at: BigInt(now),
                worker_id: "queue-worker",
                attempts: { increment: 1 }
            }
        });

        await prisma.executionLog.create({
            data: {
                worker_id: "queue-worker",
                executed_at: BigInt(now),
                jobId: job.data.jobId
            }
        });

        const duration = Math.floor(Math.random() * 9) + 2;
        await new Promise(resolve => setTimeout(resolve, duration * 1000));

        if (Math.random() < 0.2) {
            console.log(`[Attempt ${job.attemptsMade + 1}] Failed (simulated):`, job.data.jobId);
            throw new Error("Simulated worker failure");
        }

        await prisma.job.update({
            where: { id: job.data.jobId },
            data: {
                status: "DONE",
                completed_at: BigInt(Date.now())
            }
        });

        console.log(`[Attempt ${job.attemptsMade + 1}] Finished:`, job.data.jobId);
    },
    {
        connection,
        concurrency: 3
    }
);

worker.on("failed", async (job, err) => {
    console.error("Job failed:", job?.data?.jobId, err.message);
    if (job && job.attemptsMade >= (job.opts?.attempts || 4) - 1) {
        await prisma.job.update({
            where: { id: job.data.jobId },
            data: { status: "FAILED" }
        });
        console.log("Job marked as FAILED:", job.data.jobId);
    }
});

worker.on("completed", (job) => {
    console.log("Job completed:", job.data.jobId);
});

console.log("Queue worker started (concurrency: 3)");
