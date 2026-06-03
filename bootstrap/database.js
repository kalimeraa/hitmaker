const mongoose = require("mongoose");
const { mongoUri } = require("../config/app");

async function connectDb() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);
}

module.exports = { connectDb };
