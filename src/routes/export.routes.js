const express = require("express");

const router = express.Router();

const exportController = require("../controllers/export.controller");

router.post("/",exportController.createExport);

module.exports = router;