// index.js
const express = require('express');
const path = require('path');
const dotenv = require('dotenv'); // Make sure dotenv is required

dotenv.config(); // Load environment variables from .env FIRST THING

const connectDB = require('./config/db'); // This can now safely access process.env.MONGO_URI
const apiRoutes = require('./routes/apiRoutes'); // For general API (login/register)
const adminRoutes = require('./routes/adminRoutes'); // For admin-specific API
const restaurantRoutes = require('./routes/restaurantRoutes'); // For restaurant-specific API
const customerRoutes = require('./routes/customerRoutes'); // <--- NEW: For customer-specific API

connectDB(); // Connect to MongoDB

const app = express();

app.use(express.json()); // Enable parsing of JSON request bodies

// Serve static files (HTML, CSS, JS) from public folder
app.use(express.static(path.join(__dirname, 'public')));

// 👉 Show login page when user hits root URL
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Serve dashboard pages from the 'views' folder
app.get('/admin-dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'admin-dashboard.html'));
});

app.get('/restaurant-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'restaurant-dashboard.html'));
});

app.get('/customer-dashboard.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'customer-dashboard.html'));
});


// API endpoints
app.use('/api', apiRoutes); // General API routes (e.g., /api/register, /api/login)
app.use('/api/admin', adminRoutes); // Admin-specific API routes (e.g., /api/admin/dashboard-counts)
app.use('/api/restaurant', restaurantRoutes); // Restaurant-specific API routes
app.use('/api/customer', customerRoutes); // <--- NEW: Customer-specific API routes


const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});



