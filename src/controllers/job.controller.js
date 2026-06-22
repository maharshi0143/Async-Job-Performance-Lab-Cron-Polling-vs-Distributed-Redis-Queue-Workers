const jobService = require('../services/job.service');

// Creating a job
async function createJob(req,res){
    try{
        const job = await jobService.createJob(req.body);

        res.status(201).json(job);
    } catch (error) {
        console.error("Job creation error:", error);
        res.status(500).json({
            message: "Something went wrong while creating the job",
        });
    }
}



module.exports = {
    createJob
};