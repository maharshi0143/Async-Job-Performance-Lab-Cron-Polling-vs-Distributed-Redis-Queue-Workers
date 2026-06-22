require("dotenv").config();

const prisma = require("../config/prisma");

const CRON_INTERVAL = parseInt(process.env.CRON_INTERVAL_MS, 10) || 10000;
const ADVISORY_LOCKING = process.env.ADVISORY_LOCKING_ENABLED !== "false";

let running = false;

function uuidToInt(uuid) {
    const hex = uuid.replace(/-/g, "").substring(0, 8);
    return parseInt(hex, 16);
}

async function processCronJobs() {
    if (running) return;
    running = true;

    try {
        const jobs = await prisma.job.findMany({
            where: {
                type: "CRON",
                status: "PENDING"
            },
            orderBy: { priority: "asc" }
        });

        for (const job of jobs) {
            let canProcess = true;

            if (ADVISORY_LOCKING) {
                const lockKey = uuidToInt(job.id);
                const result = await prisma.$queryRawUnsafe(
                    "SELECT pg_try_advisory_lock($1) AS locked",
                    lockKey
                );
                canProcess = result[0]?.locked === true;
            }

            if (!canProcess) {
                console.log(`Skipping ${job.id} (advisory lock held by another worker)`);
                continue;
            }

            try {
                const now = Date.now();
                console.log("Cron processing:", job.id);

                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: "ACTIVE",
                        started_at: BigInt(now),
                        worker_id: "cron-worker",
                        attempts: { increment: 1 }
                    }
                });

                await prisma.executionLog.create({
                    data: {
                        worker_id: "cron-worker",
                        executed_at: BigInt(now),
                        jobId: job.id
                    }
                });

                const duration = Math.floor(Math.random() * 9) + 2;
                await new Promise(resolve => setTimeout(resolve, duration * 1000));

                await prisma.job.update({
                    where: { id: job.id },
                    data: {
                        status: "DONE",
                        completed_at: BigInt(Date.now())
                    }
                });

                console.log("Cron finished:", job.id);
            } finally {
                if (ADVISORY_LOCKING) {
                    const lockKey = uuidToInt(job.id);
                    await prisma.$executeRawUnsafe(
                        "SELECT pg_advisory_unlock($1)",
                        lockKey
                    );
                }
            }
        }
    } catch (err) {
        console.error("Cron cycle error:", err);
    } finally {
        running = false;
    }
}

console.log(`Cron worker started (interval: ${CRON_INTERVAL}ms, advisory locking: ${ADVISORY_LOCKING})`);
setInterval(processCronJobs, CRON_INTERVAL);

process.on("SIGTERM", () => {
    console.log("Cron worker shutting down...");
    process.exit(0);
});

process.on("SIGINT", () => {
    console.log("Cron worker shutting down...");
    process.exit(0);
});
