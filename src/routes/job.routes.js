const express = require("express");
const jobController = require("../controllers/job.controller");

const router = express.Router();

// Create a job
router.post("/create", jobController.createJob);

module.exports = router;