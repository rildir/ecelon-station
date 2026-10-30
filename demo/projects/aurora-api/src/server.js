import express from "express";
import inventory from "./routes/inventory.js";
import transfers from "./routes/transfers.js";

const app = express();
app.use(express.json());
app.use("/inventory", inventory);
app.use("/transfers", transfers);

const PORT = process.env.PORT || 3100;
app.listen(PORT, () => console.log(`aurora-api listening on ${PORT}`));
