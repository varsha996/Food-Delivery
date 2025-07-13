// routes/customerRoutes.js
const express = require('express');
const { User, FoodItem, Restaurant, Order, Cart, FeedbackCustomer, FeedbackAdmin, Admin, FeedbackUserToAdmin } = require('../models/schema'); // Added FeedbackUserToAdmin, Admin
const { protect, authorize } = require('../middleware/auth');
const { findOrCreateCart } = require('../middleware/customerMiddleware');
const router = express.Router();

// All routes in this file will be prefixed with /api/customer
// And should generally require 'customer' role
router.use(protect, authorize('customer'));


// @desc    Get dashboard counts for customer overview
// @route   GET /api/customer/dashboard-counts
// @access  Private (Customer only)
router.get('/dashboard-counts', async (req, res) => {
    try {
        const userId = req.user._id;

        // Get items in cart
        const cart = await Cart.findOne({ user: userId });
        const itemsInCart = cart ? cart.items.length : 0;

        // Get pending orders
        const pendingOrders = await Order.countDocuments({ user: userId, status: 'pending' });

        // Get delivered orders
        const deliveredOrders = await Order.countDocuments({ user: userId, status: 'delivered' });

        // Get count of unique restaurants visited (from delivered orders)
        const distinctRestaurantIds = await Order.distinct('restaurant', { user: userId, status: 'delivered' });
        const restaurantsVisited = distinctRestaurantIds.length;

        res.status(200).json({
            itemsInCart,
            pendingOrders,
            deliveredOrders,
            restaurantsVisited
        });

    } catch (error) {
        console.error('Error fetching customer dashboard counts:', error);
        res.status(500).json({ message: 'Server error fetching dashboard data' });
    }
});

// @desc    Get all food item categories (for filtering)
// @route   GET /api/customer/categories
// @access  Private (Customer only) - Accessed by customer dashboard
router.get('/categories', async (req, res) => {
    try {
        const adminConfig = await Admin.findOne(); // Get the single Admin config document
        if (!adminConfig) {
            return res.status(200).json([]); // Return empty array if no admin config found
        }
        res.status(200).json(adminConfig.categories);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ message: 'Server error fetching categories' });
    }
});


// @desc    Get all food items (optionally filtered by category, search, or location)
// @route   GET /api/customer/food-items
// @access  Private (Customer only)
router.get('/food-items', async (req, res) => {
    try {
        const { category, search, location } = req.query; // Added location
        let foodItemFilter = {}; // Filter for food items
        let restaurantFilter = {}; // Filter for restaurants (if location is provided)

        if (category && category !== 'all') {
            foodItemFilter.category = category;
        }

        if (search) {
            foodItemFilter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        // Apply location filter to restaurants first, then use their IDs for food items
        if (location) {
            restaurantFilter.address = { $regex: location, $options: 'i' };
            const matchingRestaurants = await Restaurant.find(restaurantFilter).select('_id');
            const restaurantIds = matchingRestaurants.map(r => r._id);
            foodItemFilter.restaurant = { $in: restaurantIds };

            if (restaurantIds.length === 0) {
                return res.status(200).json([]); // No restaurants found for the given location
            }
        }

        // Populate restaurant details for each food item
        const foodItems = await FoodItem.find(foodItemFilter).populate('restaurant', 'title image address');
        res.status(200).json(foodItems);
    } catch (error) {
        console.error('Error fetching food items:', error);
        res.status(500).json({ message: 'Server error fetching food items' });
    }
});


// @desc    Get list of all restaurants (optionally filtered by location)
// @route   GET /api/customer/restaurants
// @access  Private (Customer only)
router.get('/restaurants', async (req, res) => {
    try {
        const { location } = req.query; // Added location
        let filter = {};

        if (location) {
            filter.address = { $regex: location, $options: 'i' }; // Case-insensitive search
        }

        const restaurants = await Restaurant.find(filter);
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('Error fetching restaurants:', error);
        res.status(500).json({ message: 'Server error fetching restaurants' });
    }
});

// @desc    Get list of popular restaurants (from Admin config)
// @route   GET /api/customer/popular-restaurants
// @access  Private (Customer only)
router.get('/popular-restaurants', async (req, res) => {
    try {
        const adminConfig = await Admin.findOne().populate('promotedRestaurants', 'title image address'); // Populate actual restaurant details
        if (!adminConfig) {
            return res.status(200).json({ promotedRestaurants: [], message: 'No popular restaurants configured yet.' });
        }
        res.status(200).json({ promotedRestaurants: adminConfig.promotedRestaurants });
    } catch (error) {
        console.error('Error fetching popular restaurants:', error);
        res.status(500).json({ message: 'Server error fetching popular restaurants.' });
    }
});


// --- Cart Management ---

// @desc    Get customer's cart items
// @route   GET /api/customer/cart
// @access  Private (Customer only)
router.get('/cart', findOrCreateCart, async (req, res) => {
    try {
        console.log('Backend: Starting GET /api/customer/cart for user:', req.user._id);
        const cart = req.cart; // Cart object from middleware
        
        if (!cart) {
            console.warn('Backend: Cart object not found even after findOrCreateCart middleware. This should not happen.');
            return res.status(500).json({ message: 'Internal server error: Cart object not available.' });
        }

        let populatedCart;
        try {
            // Attempt population using an array for multiple paths
            populatedCart = await cart.populate([
                {
                    path: 'items.foodItem',
                    model: 'FoodItem',
                    select: 'title price image discount', // Fields to retrieve for foodItem
                    populate: {
                        path: 'restaurant',
                        model: 'Restaurant',
                        select: 'title' // Fields to retrieve for nested foodItem.restaurant
                    }
                },
                {
                    path: 'items.restaurant', // This targets the direct 'restaurant' field on the cart item
                    model: 'Restaurant',
                    select: 'title' // Fields to retrieve for the direct item.restaurant
                }
            ]);
            console.log('Backend: Successfully populated cart.');
        } catch (populateError) {
            console.error('Backend: Error during cart population:', populateError);
            // Re-throw to be caught by the outer try-catch for standard 500 response
            throw populateError; 
        }

        // After population, verify structure (optional, but good for debugging)
        if (populatedCart && populatedCart.items) {
            populatedCart.items.forEach((item, index) => {
                if (!item.foodItem || !item.foodItem._id || !item.restaurant || !item.restaurant._id) {
                    console.warn(`Backend: WARNING: Populated cart item at index ${index} might be malformed. Missing foodItem or restaurant._id. Item:`, JSON.stringify(item));
                    // This warning helps identify if a specific item is causing issues
                }
            });
        }

        res.status(200).json({ items: populatedCart.items });
    } catch (error) {
        console.error('Backend: Unhandled error in GET /api/customer/cart route:', error);
        res.status(500).json({ message: 'Server error fetching cart' });
    }
});

// @desc    Add item to cart
// @route   POST /api/customer/cart/add
// @access  Private (Customer only)
router.post('/cart/add', findOrCreateCart, async (req, res) => {
    const { foodItemId, quantity, priceAtTimeOfAddition, restaurantId } = req.body;

    if (!foodItemId || !quantity || !priceAtTimeOfAddition || !restaurantId) {
        return res.status(400).json({ message: 'Food item ID, quantity, price, and restaurant ID are required.' });
    }

    try {
        const foodItem = await FoodItem.findById(foodItemId);
        if (!foodItem) {
            return res.status(404).json({ message: 'Food item not found.' });
        }

        // Basic check to ensure the food item actually belongs to the provided restaurantId
        if (foodItem.restaurant.toString() !== restaurantId) {
            return res.status(400).json({ message: 'Food item does not belong to the specified restaurant.' });
        }

        const cart = req.cart; // Cart object from middleware

        // Check if item already exists in cart for the same restaurant
        const existingCartItemIndex = cart.items.findIndex(
            (item) => item.foodItem.toString() === foodItemId && item.restaurant.toString() === restaurantId
        );

        if (existingCartItemIndex > -1) {
            // Update quantity if item already exists
            cart.items[existingCartItemIndex].quantity += quantity;
            cart.items[existingCartItemIndex].addedAt = Date.now(); // Update timestamp
        } else {
            // Add new item to cart
            cart.items.push({
                foodItem: foodItemId,
                quantity,
                priceAtTimeOfAddition,
                restaurant: restaurantId, // Ensure this is the ID, it will be populated on GET
            });
        }

        await cart.save();
        res.status(200).json({ message: 'Item added to cart successfully!', cartItemCount: cart.items.length });

    } catch (error) {
        console.error('Error adding item to cart:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error adding item to cart.' });
    }
});


// @desc    Update item quantity in cart
// @route   PUT /api/customer/cart/:cartItemId
// @access  Private (Customer only)
router.put('/cart/:cartItemId', findOrCreateCart, async (req, res) => {
    const { quantity } = req.body;
    const cartItemId = req.params.cartItemId;

    if (!quantity || quantity < 1) {
        return res.status(400).json({ message: 'Quantity must be a positive number.' });
    }

    try {
        const cart = req.cart;
        const itemIndex = cart.items.findIndex(item => item._id.toString() === cartItemId);

        if (itemIndex === -1) {
            return res.status(404).json({ message: 'Cart item not found.' });
        }

        cart.items[itemIndex].quantity = quantity;
        cart.items[itemIndex].addedAt = Date.now(); // Update timestamp
        await cart.save();
        res.status(200).json({ message: 'Cart item quantity updated.' });

    } catch (error) {
        console.error('Error updating cart item quantity:', error);
        res.status(500).json({ message: 'Server error updating cart item quantity.' });
    }
});

// @desc    Remove item from cart
// @route   DELETE /api/customer/cart/:cartItemId
// @access  Private (Customer only)
router.delete('/cart/:cartItemId', findOrCreateCart, async (req, res) => {
    const cartItemId = req.params.cartItemId;

    try {
        const cart = req.cart;
        const initialLength = cart.items.length;
        cart.items = cart.items.filter(item => item._id.toString() !== cartItemId);

        if (cart.items.length === initialLength) {
            return res.status(404).json({ message: 'Cart item not found.' });
        }

        await cart.save();
        res.status(200).json({ message: 'Item removed from cart.' });

    } catch (error) {
        console.error('Error removing item from cart:', error);
        res.status(500).json({ message: 'Server error removing item from cart.' });
    }
});

// @desc    Clear entire cart
// @route   DELETE /api/customer/cart/clear
// @access  Private (Customer only)
router.delete('/cart/clear', findOrCreateCart, async (req, res) => {
    try {
        const cart = req.cart;
        if (cart.items.length === 0) {
            return res.status(200).json({ message: 'Cart is already empty.' });
        }
        cart.items = []; // Clear all items
        await cart.save();
        res.status(200).json({ message: 'Cart cleared successfully.' });
    } catch (error) {
        console.error('Error clearing cart:', error);
        res.status(500).json({ message: 'Server error clearing cart.' });
    }
});


// --- Order Placement & Management ---

// @desc    Place a new order from cart
// @route   POST /api/customer/orders
// @access  Private (Customer only)
router.post('/orders', findOrCreateCart, async (req, res) => {
    // This endpoint is designed to receive a single order object (for one restaurant)
    // The frontend handles splitting the cart into multiple orders if needed.
    const { restaurant, items, paymentMethod, deliveryAddress } = req.body;

    if (!restaurant || !items || items.length === 0) {
        return res.status(400).json({ message: 'Order must specify a restaurant and contain items.' });
    }

    // Use the user's stored address if deliveryAddress is not explicitly provided
    const user = await User.findById(req.user._id).select('address');
    const finalDeliveryAddress = deliveryAddress || user.address || 'Not specified'; // Fallback

    try {
        // Verify all food items exist and belong to the specified restaurant
        for (const item of items) {
            const foodItem = await FoodItem.findById(item.foodItem);
            if (!foodItem || foodItem.restaurant.toString() !== restaurant) {
                return res.status(400).json({ message: `Invalid food item ${item.foodItem} or it does not belong to the specified restaurant.` });
            }
            
            // Ensure price in request matches the price at time of addition/current price
            const actualUnitPrice = foodItem.price * (1 - (foodItem.discount || 0) / 100);
            if (item.price.toFixed(2) !== actualUnitPrice.toFixed(2)) {
               console.warn(`Price mismatch for ${foodItem.title}. Cart price: ${item.price}, Current price: ${actualUnitPrice}`);
            }
        }

        const newOrder = new Order({
            user: req.user._id,
            restaurant,
            items,
            paymentMethod: paymentMethod || 'COD', // Default to COD if not provided
            deliveryAddress: finalDeliveryAddress // Use the determined delivery address
        });

        await newOrder.save();

        // After successful order, clear the ordered items from the user's cart
        const cart = req.cart;
        // Filter out items that were just ordered (belonging to this specific restaurant)
        cart.items = cart.items.filter(item => item.restaurant.toString() !== restaurant);
        await cart.save(); // Save the updated cart

        res.status(201).json({ message: 'Order placed successfully!', order: newOrder });

    } catch (error) {
        console.error('Error placing order:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error placing order.' });
    }
});


// @desc    Get all orders for the logged-in customer
// @route   GET /api/customer/orders
// @access  Private (Customer only)
router.get('/orders', async (req, res) => {
    try {
        const orders = await Order.find({ user: req.user._id })
            .populate('restaurant', 'title image') // Get restaurant title and image
            .populate('items.foodItem', 'title price image discount') // Get food item details
            .sort({ orderDate: -1 }); // Latest orders first
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching customer orders:', error);
        res.status(500).json({ message: 'Server error fetching customer orders' });
    }
});


// @desc    Cancel an order
// @route   PUT /api/customer/orders/:id/cancel
// @access  Private (Customer only)
router.put('/orders/:id/cancel', async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);

        if (!order) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Ensure the order belongs to the logged-in user
        if (order.user.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Access denied. You can only cancel your own orders.' });
        }

        // Only allow cancellation if order is pending or preparing
        if (order.status === 'delivered' || order.status === 'cancelled') {
            return res.status(400).json({ message: `Cannot cancel an order that is already ${order.status}.` });
        }

        order.status = 'cancelled';
        await order.save();

        res.status(200).json({ message: 'Order cancelled successfully!', order });
    } catch (error) {
        console.error('Error cancelling order:', error);
        res.status(500).json({ message: 'Server error cancelling order.' });
    }
});


// --- Customer Profile Management ---

// @desc    Get logged-in customer's profile
// @route   GET /api/customer/profile
// @access  Private (Customer only)
router.get('/profile', async (req, res) => {
    try {
        // Fetch the full user document to include address and phone
        const user = await User.findById(req.user._id).select('-password'); // Exclude password
        if (!user) {
            return res.status(404).json({ message: 'User profile not found.' });
        }
        res.status(200).json({ user: user });
    } catch (error) {
        console.error('Error fetching customer profile:', error);
        res.status(500).json({ message: 'Server error fetching profile data.' });
    }
});

// @desc    Update logged-in customer's profile
// @route   PUT /api/customer/profile
// @access  Private (Customer only)
router.put('/profile', async (req, res) => {
    const { name, address, phone } = req.body; // Added address and phone

    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }

        user.name = name || user.name;
        user.address = address !== undefined ? address : user.address; // Allow empty string update
        user.phone = phone !== undefined ? phone : user.phone; // Allow empty string update

        await user.save();

        res.status(200).json({
            message: 'Profile updated successfully!',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                userType: user.userType,
                approval: user.approval,
                address: user.address, // Include updated address
                phone: user.phone // Include updated phone
            }
        });

    } catch (error) {
        console.error('Error updating customer profile:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error updating profile.' });
    }
});


// --- Customer Feedback (Rating to Restaurant) ---

// @desc    Submit customer feedback to a restaurant (rating)
// @route   POST /api/customer/feedback
// @access  Private (Customer only)
router.post('/feedback', async (req, res) => {
    const { order, restaurant, rating, message } = req.body;

    if (!restaurant || !rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: 'Restaurant ID and a valid rating (1-5) are required.' });
    }

    try {
        if (order) {
            const existingOrder = await Order.findById(order);
            if (!existingOrder || existingOrder.user.toString() !== req.user._id.toString()) {
                return res.status(403).json({ message: 'Order not found or does not belong to you.' });
            }
            if (existingOrder.status !== 'delivered') {
                return res.status(400).json({ message: 'You can only rate delivered orders.' });
            }
            const alreadyRated = await FeedbackCustomer.findOne({ user: req.user._id, order: order });
            if (alreadyRated) {
                return res.status(400).json({ message: 'You have already rated this order.' });
            }
        }

        const newFeedback = new FeedbackCustomer({
            user: req.user._id,
            receiver: restaurant, // Changed from 'restaurant' to 'receiver' as per schema likely
            order: order || null,
            rating,
            message: message || ''
        });

        await newFeedback.save();
        res.status(201).json({ message: 'Feedback submitted successfully!', feedback: newFeedback });

    } catch (error) {
        console.error('Error submitting customer feedback:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error submitting feedback.' });
    }
});


// --- Customer Feedback TO Admin ---

// @desc    Send feedback to admin (from customer)
// @route   POST /api/customer/feedback/admin
// @access  Private (Customer only)
router.post('/feedback/admin', async (req, res) => {
    const { message } = req.body;
    if (!message || message.trim() === '') {
        return res.status(400).json({ message: 'Feedback message cannot be empty.' });
    }

    try {
        const newFeedbackToAdmin = new FeedbackUserToAdmin({
            sender: req.user._id,
            message: message.trim(),
            status: 'new'
        });
        await newFeedbackToAdmin.save();
        res.status(201).json({ message: 'Feedback sent to admin successfully!', feedback: newFeedbackToAdmin });
    } catch (error) {
        console.error('Error sending customer feedback to admin:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error sending feedback to admin.' });
    }
});

// @desc    Get feedback sent by this customer TO admin
// @route   GET /api/customer/feedback/admin-sent
// @access  Private (Customer only)
router.get('/feedback/admin-sent', async (req, res) => {
    try {
        const feedback = await FeedbackUserToAdmin.find({ sender: req.user._id }).sort({ createdAt: -1 });
        res.status(200).json(feedback);
    } catch (error) {
        console.error('Error fetching customer feedback to admin:', error);
        res.status(500).json({ message: 'Server error fetching customer feedback to admin.' });
    }
});


module.exports = router;


