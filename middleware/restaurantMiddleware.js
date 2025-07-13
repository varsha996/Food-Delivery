// middleware/restaurantMiddleware.js
const { Restaurant } = require('../models/schema');

const findRestaurant = async (req, res, next) => {
  try {
    // Ensure req.user exists (this middleware should only run AFTER 'protect')
    if (!req.user || !req.user._id) {
      // This case should ideally not be hit if 'protect' runs successfully before this
      return res.status(401).json({ message: 'Authentication required. User not identified.' });
    }

    // Attempt to find the restaurant owned by the current user
    const restaurant = await Restaurant.findOne({ owner: req.user._id });
    req.restaurant = restaurant; // Attach found restaurant (or null) to the request

    next();
  } catch (error) {
    console.error('Error in findRestaurant middleware:', error);
    res.status(500).json({ message: 'Server error during restaurant profile lookup.' });
  }
};

module.exports = { findRestaurant };
