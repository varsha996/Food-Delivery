// routes/apiRoutes.js
const express = require('express');
const jwt = require('jsonwebtoken');
const { User } = require('../models/schema'); // Import User model

const router = express.Router();

// Helper function to generate JWT token - THIS MUST BE DEFINED BEFORE IT'S USED
const generateToken = (id, userType) => {
  return jwt.sign({ id, userType }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '1h',
  });
};

// @desc    Register a new user
// @route   POST /api/register
// @access  Public
router.post('/register', async (req, res) => {
  const { name, email, password, userType } = req.body;

  try {
    // Check if user already exists
    let user = await User.findOne({ email });
    if (user) {
      return res.status(400).json({ message: 'User already exists' });
    }

    // Create new user (password hashing is handled by the pre-save hook in the schema)
    user = await User.create({
      name,
      email,
      password,
      userType,
      approval: (userType === 'customer') ? 'accepted' : 'pending' // Customers are auto-approved
    });

    // Ensure generateToken is called here
    const token = generateToken(user._id, user.userType);

    res.status(201).json({
      message: 'Registration successful',
      user: {
        id: user._id,
        name: user.name, // Make sure name is included here
        email: user.email,
        userType: user.userType,
        approval: user.approval
      },
      token,
    });

  } catch (error) {
    console.error('Registration error:', error);
    if (error.name === 'ValidationError') {
        const messages = Object.values(error.errors).map(val => val.message);
        return res.status(400).json({ message: messages.join(', ') });
    }
    // Make sure to return an error response
    res.status(500).json({ message: 'Server error during registration' });
  }
});

// @desc    Authenticate user & get token
// @route   POST /api/login
// @access  Public
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    // Check for user email
    const user = await User.findOne({ email }).select('+password'); // Explicitly select password

    if (!user) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(400).json({ message: 'Invalid Credentials' });
    }

    // Check approval status for restaurant/admin
    if (user.userType !== 'customer' && user.approval === 'pending') {
      return res.status(403).json({ message: 'Your account is pending approval by an admin.' });
    }

    // Ensure generateToken is called here
    const token = generateToken(user._id, user.userType);

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user._id,
        name: user.name, // Make sure name is included here
        email: user.email,
        userType: user.userType,
        approval: user.approval
      },
      token,
    });

  } catch (error) {
    console.error('Login error:', error);
    // Make sure to return an error response
    res.status(500).json({ message: 'Server error during login' });
  }
});

module.exports = router;


