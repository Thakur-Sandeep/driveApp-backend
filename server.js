const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
require('dotenv').config();

const app = express();

// Middleware
app.use(cors({
  origin: [
    "http://localhost:3000", 
    "https://drive-app-frontend.vercel.app"
  ],
  credentials: true
}));
app.use(express.json());

// Connect to MongoDB
mongoose.connect(process.env.MONGO_URL)
  .then(() => console.log("🚀 MongoDB Connected"))
  .catch(err => console.log("❌ Connection Error:", err));

// Routes
app.use('/api/files', require('./Routes/fileRoutes'));

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));