-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'ACTIVE', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('CRON', 'QUEUE');

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 10,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_at" BIGINT NOT NULL,
    "started_at" BIGINT,
    "completed_at" BIGINT,
    "worker_id" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExecutionLog" (
    "id" SERIAL NOT NULL,
    "worker_id" TEXT NOT NULL,
    "executed_at" BIGINT NOT NULL,
    "jobId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExecutionLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "ExecutionLog" ADD CONSTRAINT "ExecutionLog_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
