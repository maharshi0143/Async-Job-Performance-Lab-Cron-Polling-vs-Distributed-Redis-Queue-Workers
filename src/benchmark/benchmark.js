require("dotenv").config();

BigInt.prototype.toJSON = function () {
    return Number(this);
};

const prisma = require("../config/prisma");
const fs = require("fs");
const path = require("path");

const API_URL = process.env.API_URL || "http://localhost:3000/api/export";
const NUM_JOBS = 100;
const POLL_INTERVAL = 500;
const TIMEOUT_MS = 900000;

async function submitJob(type, priority = 10) {
    const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, priority, user_id: "benchmark" })
    });
    if (!response.ok) {
        const body = await response.text();
        throw new Error(`Submit failed (${response.status}): ${body}`);
    }
    return await response.json();
}

async function pollUntil(jobIds, predicate, timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const jobs = await prisma.job.findMany({
            where: { id: { in: jobIds } }
        });
        if (predicate(jobs)) return jobs;
        await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    const jobs = await prisma.job.findMany({
        where: { id: { in: jobIds } }
    });
    return jobs;
}

function calculateStats(jobs) {
    const withLatency = jobs
        .filter(j => j.submitted_at != null && j.started_at != null)
        .map(j => ({ ...j, latency: Number(j.started_at) - Number(j.submitted_at) }));

    if (withLatency.length === 0) return { avg_latency_ms: 0, p95_latency_ms: 0, total_throughput_jobs_per_min: 0 };

    const latencies = withLatency.map(j => j.latency);
    const sum = latencies.reduce((a, b) => a + b, 0);
    const avg = sum / latencies.length;

    const sorted = [...latencies].sort((a, b) => a - b);
    const p95Index = Math.ceil(0.95 * sorted.length) - 1;
    const p95 = sorted[p95Index];

    const submittedTimes = withLatency.map(j => Number(j.submitted_at));
    const startedTimes = withLatency.map(j => Number(j.started_at));
    const minSubmitted = Math.min(...submittedTimes);
    const maxStarted = Math.max(...startedTimes);
    const wallClockMs = maxStarted - minSubmitted;
    const throughput = wallClockMs > 0 ? (withLatency.length / wallClockMs) * 60000 : 0;

    return { avg_latency_ms: avg, p95_latency_ms: p95, total_throughput_jobs_per_min: parseFloat(throughput.toFixed(2)) };
}

async function benchmarkPathway(type) {
    console.log(`\n=== Benchmarking ${type} pathway ===`);

    const jobIds = [];

    for (let i = 0; i < NUM_JOBS; i++) {
        const job = await submitJob(type);
        jobIds.push(job.job_id);
        if ((i + 1) % 20 === 0) console.log(`  Submitted ${i + 1}/${NUM_JOBS} ${type} jobs`);
    }

    console.log(`  Waiting for ${NUM_JOBS} ${type} jobs to be processed...`);

    const jobs = await pollUntil(
        jobIds,
        (jobs) => jobs.every(j => j.started_at != null),
        TIMEOUT_MS
    );

    const started = jobs.filter(j => j.started_at != null);
    const failed = jobs.filter(j => j.status === "FAILED");
    console.log(`  Started: ${started.length}, Failed: ${failed.length}`);

    const stats = calculateStats(started);
    console.log(`  Avg latency: ${stats.avg_latency_ms.toFixed(2)}ms`);
    console.log(`  P95 latency: ${stats.p95_latency_ms.toFixed(2)}ms`);
    console.log(`  Throughput: ${stats.total_throughput_jobs_per_min} jobs/min`);

    return stats;
}

async function main() {
    console.log("=== Job Processing Benchmark ===");
    console.log(`Submitting ${NUM_JOBS} jobs per pathway\n`);

    const cronStats = await benchmarkPathway("CRON");

    await new Promise(r => setTimeout(r, 2000));

    const queueStats = await benchmarkPathway("QUEUE");

    const result = {
        cron_stats: cronStats,
        queue_stats: queueStats
    };

    const outputDir = path.join(__dirname, "..", "..", "output");
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, "benchmarking.json");
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));
    console.log(`\nResults written to ${outputPath}`);

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error("Benchmark failed:", err);
    await prisma.$disconnect();
    process.exit(1);
});
