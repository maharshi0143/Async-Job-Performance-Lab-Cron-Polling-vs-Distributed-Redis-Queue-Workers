require("dotenv").config();

BigInt.prototype.toJSON = function () {
    return Number(this);
};

const express = require("express");
const cors = require("cors");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const jobRoutes = require("./src/routes/job.routes");
const exportRoutes = require("./src/routes/export.routes");
const exportQueue = require("./src/queues/export.queue");

const app = express();

const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath("/admin/queues");

createBullBoard({
    queues: [new BullMQAdapter(exportQueue)],
    serverAdapter
});

app.use(cors());
app.use(express.json());
app.use("/api/jobs", jobRoutes);
app.use("/api/export", exportRoutes);
app.use("/admin/queues", serverAdapter.getRouter());
const PORT = process.env.PORT || 3000;

app.get("/", (req, res) => {
    res.send("Server is running...");
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});