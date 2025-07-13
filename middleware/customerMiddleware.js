// middleware/customerMiddleware.js
const { Cart } = require('../models/schema');

const findOrCreateCart = async (req, res, next) => {
  try {
    // This middleware should run AFTER 'protect', so req.user should be available
    if (!req.user || !req.user._id) {
      return res.status(401).json({ message: 'Authentication required. User not identified for cart operations.' });
    }

    let cart = await Cart.findOne({ user: req.user._id });

    if (!cart) {
      // If no cart exists, create a new one for this user
      cart = await Cart.create({ user: req.user._id, items: [] });
    }

    req.cart = cart; // Attach the cart object to the request
    next();
  } catch (error) {
    console.error('Error in findOrCreateCart middleware:', error);
    res.status(500).json({ message: 'Server error during cart lookup.' });
  }
};

module.exports = { findOrCreateCart };
