// middleware/auth.js
const jwt = require('jsonwebtoken');
const { User } = require('../models/schema');

const protect = async (req, res, next) => {
  let token;

  // --- THIS IS THE CRITICAL DEBUGGING LINE WE NEED TO SEE IN YOUR SERVER'S CONSOLE ---
  console.log('Server-side JWT_SECRET (from auth.js):', process.env.JWT_SECRET ? 'LOADED' : 'NOT LOADED or UNDEFINED');
  if (!process.env.JWT_SECRET) {
      console.error('CRITICAL SERVER ERROR: JWT_SECRET is not defined in environment variables!');
  }
  // --- END CRITICAL DEBUGGING LINE ---

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Attach user (without password) and userType to the request
      req.user = await User.findById(decoded.id).select('-password');
      req.userType = decoded.userType;
      next();
    } catch (error) {
      // Log the specific JWT verification error
      console.error('JWT Verification Error (Server-side):', error.message);
      res.status(401).json({ message: 'Not authorized, token failed' });
    }
  }

  if (!token) {
    res.status(401).json({ message: 'Not authorized, no token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.userType)) {
      return res.status(403).json({ message: `User role ${req.userType} is not authorized to access this route` });
    }
    next();
  };
};

module.exports = { protect, authorize };

