const exportService = require("../services/export.service");

async function createExport(req, res) {
    try {
        const { type, priority, user_id } = req.body || {};
        if (!type || !user_id) {
            return res.status(400).json({ message: "type and user_id are required" });
        }
        const job = await exportService.createExportJob({
            type,
            priority,
            user_id
        });
        res.status(201).json({
            job_id: job.id,
            status: job.status,
            type: job.type

        });
    }
    catch (error) {
        console.log(error);
        res.status(500).json({
            message: "Something went wrong"
        });
    }
}




module.exports = {
    createExport
};