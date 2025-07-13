// routes/restaurantRoutes.js
const express = require('express');
const { User, Restaurant, FoodItem, Order, FeedbackCustomer, FeedbackRestaurant, Admin } = require('../models/schema'); // Correct imports
const { protect, authorize } = require('../middleware/auth');
const { findRestaurant } = require('../middleware/restaurantMiddleware');
const router = express.Router();
const mongoose = require('mongoose'); // Make sure mongoose is imported for ObjectId

// Apply protect and authorize middleware to all restaurant routes unless explicitly excluded
router.use(protect, authorize('restaurant'));

// Middleware to find the restaurant linked to the authenticated user
// This custom middleware runs after protect and authorize
router.use(findRestaurant); // Apply findRestaurant middleware globally to this router

// @desc    Get the restaurant ID and title linked to the logged-in user
// @route   GET /api/restaurant/my-restaurant-id
// @access  Private (Restaurant owner only)
router.get('/my-restaurant-id', async (req, res) => { // findRestaurant middleware has already run
    try {
        if (!req.restaurant) {
            // If no restaurant document is found for the user (e.g., just approved, not created restaurant yet)
            return res.status(200).json({
                restaurantId: null,
                restaurantTitle: req.user.name + ' (Profile Incomplete)',
                restaurantExists: false // Indicate that no restaurant document exists yet
            });
        }
        res.status(200).json({
            restaurantId: req.restaurant._id,
            restaurantTitle: req.restaurant.title,
            restaurantExists: true // Indicate that a restaurant document exists
        });
    } catch (error) {
        console.error('Error fetching restaurant ID:', error);
        res.status(500).json({ message: 'Server error fetching restaurant ID.' });
    }
});

// @desc    Get all food item categories (for dropdowns)
// @route   GET /api/restaurant/categories
// @access  Private (Restaurant owner only) - Accessible by restaurant dashboard
router.get('/categories', async (req, res) => {
    try {
        const adminConfig = await Admin.findOne(); // Get the single Admin config document
        if (!adminConfig) {
            return res.status(200).json([]); // Return empty array if no admin config found
        }
        res.status(200).json(adminConfig.categories);
    } catch (error) {
        console.error('Error fetching categories for restaurant:', error);
        res.status(500).json({ message: 'Server error fetching categories for restaurant' });
    }
});


// @desc    Get dashboard counts for restaurant owner overview
// @route   GET /api/restaurant/dashboard-counts
// @access  Private (Restaurant owner only)
router.get('/dashboard-counts', async (req, res) => { // findRestaurant middleware has already run
  try {
    if (!req.restaurant) {
        return res.status(403).json({ message: 'Restaurant profile incomplete. Please set up your restaurant profile first.' });
    }
    const restaurantId = req.restaurant._id;

    const totalMenuItems = await FoodItem.countDocuments({ restaurant: restaurantId });
    const pendingOrdersCount = await Order.countDocuments({ restaurant: restaurantId, status: 'pending' });
    const deliveredOrdersCount = await Order.countDocuments({ restaurant: restaurantId, status: 'delivered' });
    const cancelledOrdersCount = await Order.countDocuments({ restaurant: restaurantId, status: 'cancelled' });

    // Calculate average rating for the restaurant
    const ratings = await FeedbackCustomer.find({ receiver: restaurantId, rating: { $exists: true, $ne: null } });
    let averageRating = 0;
    if (ratings.length > 0) {
        const totalRating = ratings.reduce((sum, feedback) => sum + feedback.rating, 0);
        averageRating = totalRating / ratings.length;
    }


    res.status(200).json({
      totalMenuItems,
      pendingOrdersCount,
      deliveredOrdersCount,
      cancelledOrdersCount,
      averageRating
    });

  } catch (error) {
    console.error('Error fetching restaurant dashboard counts:', error);
    res.status(500).json({ message: 'Server error fetching dashboard data' });
  }
});

// --- Menu Item Management ---

// @desc    Get all food items for the logged-in restaurant with average ratings
// @route   GET /api/restaurant/items
// @access  Private (Restaurant owner only)
router.get('/items', async (req, res) => { // findRestaurant middleware has already run
    try {
        if (!req.restaurant) {
            return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot access menu items.' });
        }
        const restaurantId = req.restaurant._id;

        // --- DEBUG: Log the restaurantId to confirm it's correct ---
        console.log(`Fetching food items for restaurantId: ${restaurantId}`);

        // Aggregation pipeline to get all food items and their average ratings
        const foodItemsWithAvgRating = await FoodItem.aggregate([
            {
                // Match food items belonging to the authenticated restaurant
                $match: { restaurant: new mongoose.Types.ObjectId(restaurantId) }
            },
            {
                // Lookup ratings from the 'feedbackcustomers' collection
                // 'feedbackcustomers' should be the actual collection name for your FeedbackCustomer model
                $lookup: {
                    from: 'feedbackcustomers', // CONFIRMED: This is the correct collection name based on schema.js
                    localField: '_id', // _id of the food item
                    foreignField: 'foodItem', // foodItem field in the FeedbackCustomer model
                    as: 'itemFeedbacks' // Array of feedback documents for this food item
                }
            },
            {
                // Add a new field 'averageRating' by calculating the average of 'rating' from 'itemFeedbacks'
                $addFields: {
                    averageRating: { $avg: '$itemFeedbacks.rating' }
                }
            },
            {
                // Project (select) the fields you want to return
                // Also, handle cases where 'averageRating' might be null (no reviews yet)
                $project: {
                    _id: 1,
                    title: 1,
                    description: 1,
                    category: 1,
                    price: 1,
                    discount: { $ifNull: ['$discount', 0] }, // Confirmed 'discount' from schema.js
                    image: 1,
                    averageRating: { $ifNull: ['$averageRating', null] } // Return null if no ratings, instead of NaN
                }
            }
        ]);

        // --- DEBUG: Log the result of the aggregation ---
        console.log('Aggregation result (foodItemsWithAvgRating):', JSON.stringify(foodItemsWithAvgRating, null, 2));

        res.status(200).json(foodItemsWithAvgRating);

    } catch (error) {
        console.error('Error fetching food items:', error);
        res.status(500).json({ message: 'Server error fetching food items' });
    }
});

// @desc    Add a new food item for the logged-in restaurant
// @route   POST /api/restaurant/items
// @access  Private (Restaurant owner only)
router.post('/items', async (req, res) => { // findRestaurant middleware has already run
    const { title, description, image, category, price, discount } = req.body;

    if (!req.restaurant) {
        return res.status(403).json({ message: 'Restaurant profile incomplete. Please set up your restaurant profile first.' });
    }
    const restaurantId = req.restaurant._id; // Get restaurant ID from the request object

    try {
        const newFoodItem = new FoodItem({
            title,
            description,
            image,
            category,
            restaurant: restaurantId, // Assign to the logged-in restaurant
            price,
            discount
        });

        await newFoodItem.save();
        res.status(201).json({ message: 'Menu item added successfully!', item: newFoodItem });

    } catch (error) {
        console.error('Error adding food item:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error adding food item' });
    }
});

// @desc    Update a food item for the logged-in restaurant
// @route   PUT /api/restaurant/items/:id
// @access  Private (Restaurant owner only)
router.put('/items/:id', async (req, res) => { // findRestaurant middleware has already run
    const itemId = req.params.id;

    if (!req.restaurant) {
        return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot update menu items.' });
    }
    const restaurantId = req.restaurant._id;

    const { title, description, image, category, price, discount } = req.body;

    try {
        const foodItem = await FoodItem.findById(itemId);

        if (!foodItem) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        // Ensure the food item belongs to the authenticated restaurant
        if (foodItem.restaurant.toString() !== restaurantId.toString()) {
            return res.status(403).json({ message: 'Access denied. You can only update your own menu items.' });
        }

        foodItem.title = title || foodItem.title;
        foodItem.description = description || foodItem.description;
        foodItem.image = image || foodItem.image;
        foodItem.category = category || foodItem.category;
        foodItem.price = price !== undefined ? price : foodItem.price;
        foodItem.discount = discount !== undefined ? discount : foodItem.discount;

        await foodItem.save();
        res.status(200).json({ message: 'Menu item updated successfully!', item: foodItem });

    } catch (error) {
        console.error('Error updating food item:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error updating food item' });
    }
});

// @desc    Delete a food item for the logged-in restaurant
// @route   DELETE /api/restaurant/items/:id
// @access  Private (Restaurant owner only)
router.delete('/items/:id', async (req, res) => { // findRestaurant middleware has already run
    const itemId = req.params.id;

    if (!req.restaurant) {
        return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot delete menu items.' });
    }
    const restaurantId = req.restaurant._id;

    try {
        const foodItem = await FoodItem.findById(itemId);

        if (!foodItem) {
            return res.status(404).json({ message: 'Menu item not found' });
        }

        // Ensure the food item belongs to the authenticated restaurant
        if (foodItem.restaurant.toString() !== restaurantId.toString()) {
            return res.status(403).json({ message: 'Access denied. You can only delete your own menu items.' });
        }

        await FoodItem.deleteOne({ _id: itemId });
        res.status(200).json({ message: 'Menu item deleted successfully!' });

    } catch (error) {
        console.error('Error deleting food item:', error);
        res.status(500).json({ message: 'Server error deleting food item' });
    }
});

// --- Order Management ---

// @desc    Get all orders for the logged-in restaurant
// @route   GET /api/restaurant/orders
// @access  Private (Restaurant owner only)
router.get('/orders', async (req, res) => { // findRestaurant middleware has already run
    try {
        if (!req.restaurant) {
            return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot access orders.' });
        }
        const restaurantId = req.restaurant._id;

        const orders = await Order.find({ restaurant: restaurantId })
            .populate('user', 'name email')
            .populate('items.foodItem', 'title price'); // Populate food item details within items array

        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching restaurant orders:', error);
        res.status(500).json({ message: 'Server error fetching restaurant orders' });
    }
});

// @desc    Update order status for the logged-in restaurant
// @route   PUT /api/restaurant/orders/:id/status
// @access  Private (Restaurant owner only)
router.put('/orders/:id/status', async (req, res) => { // findRestaurant middleware has already run
    const orderId = req.params.id;
    const { status } = req.body;

    if (!req.restaurant) {
        return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot update order status.' });
    }
    const restaurantId = req.restaurant._id;

    // Validate status
    const validStatuses = ['pending', 'preparing', 'delivered', 'cancelled'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ message: 'Invalid order status provided.' });
    }

    try {
        const order = await Order.findById(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Order not found.' });
        }

        // Ensure the order belongs to the authenticated restaurant
        if (order.restaurant.toString() !== restaurantId.toString()) {
            return res.status(403).json({ message: 'Access denied. You can only update your own restaurant\'s orders.' });
        }

        order.status = status;
        await order.save();

        res.status(200).json({ message: `Order ${orderId} status updated to ${status}.`, order });
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).json({ message: 'Server error updating order status.' });
    }
});

// --- Customer Ratings & Feedback ---

// @desc    Get customer feedback for the logged-in restaurant
// @route   GET /api/restaurant/feedback/customer
// @access  Private (Restaurant owner only)
router.get('/feedback/customer', async (req, res) => { // findRestaurant middleware has already run
    try {
        if (!req.restaurant) {
            return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot access customer feedback.' });
        }
        const restaurantId = req.restaurant._id;

        const feedback = await FeedbackCustomer.find({ receiver: restaurantId })
            .populate('user', 'name email') // Populate user who gave feedback
            .populate('foodItem', 'title') // ADDED: Populate foodItem title for display
            .sort({ createdAt: -1 }); // Latest feedback first
        res.status(200).json(feedback);
    } catch (error) {
        console.error('Error fetching customer feedback for restaurant:', error);
        res.status(500).json({ message: 'Server error fetching customer feedback.' });
    }
});

// --- Feedback to Admin ---

// @desc    Get feedback sent by this restaurant to admin
// @route   GET /api/restaurant/feedback/admin-sent
// @access  Private (Restaurant owner only)
router.get('/feedback/admin-sent', async (req, res) => { // findRestaurant middleware has already run
    try {
        if (!req.restaurant) {
            return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot access feedback to admin.' });
        }
        const restaurantId = req.restaurant._id;
        // Assuming FeedbackRestaurant 'restaurant' field is the Restaurant ObjectId
        const feedback = await FeedbackRestaurant.find({ restaurant: restaurantId }).sort({ createdAt: -1 });
        res.status(200).json(feedback);
    } catch (error) {
        console.error('Error fetching restaurant feedback to admin:', error);
        res.status(500).json({ message: 'Server error fetching feedback to admin.' });
    }
});


// @desc    Send feedback to admin (from restaurant)
// @route   POST /api/restaurant/feedback/admin
// @access  Private (Restaurant owner only)
router.post('/feedback/admin', async (req, res) => { // findRestaurant middleware has already run
    const { message } = req.body;
    if (!message || message.trim() === '') {
        return res.status(400).json({ message: 'Feedback message cannot be empty.' });
    }
    if (!req.restaurant) {
        return res.status(403).json({ message: 'Restaurant profile incomplete. Cannot send feedback.' });
    }
    const restaurantId = req.restaurant._id;


    try {
        const newFeedback = new FeedbackRestaurant({
            restaurant: restaurantId,
            admin: null, // Admin field can be null as it's from restaurant *to* admin
            message: message.trim(),
            status: 'new'
        });
        await newFeedback.save();
        res.status(201).json({ message: 'Feedback sent to admin successfully!', feedback: newFeedback });
    } catch (error) {
        console.error('Error sending feedback to admin:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error sending feedback to admin.' });
    }
});


// --- Restaurant Profile Management (Self-service) ---

// @desc    Get current restaurant's profile details
// @route   GET /api/restaurant/profile
// @access  Private (Restaurant owner only)
router.get('/profile', async (req, res) => { // findRestaurant middleware has already run
    try {
        if (!req.restaurant) {
            // This case handles when a restaurant user is approved but hasn't created their restaurant entity yet.
            // Return a specific status that the frontend can use to show the creation form.
            return res.status(200).json({ restaurant: null, message: "No restaurant profile found. Please create one." });
        }
        res.status(200).json({ restaurant: req.restaurant, owner: req.user }); // ADDED: Pass req.user (owner) info
    } catch (error) {
        console.error('Error fetching restaurant profile:', error);
        res.status(500).json({ message: 'Server error fetching restaurant profile.' });
    }
});

// @desc    Create a new restaurant profile for the logged-in user
// @route   POST /api/restaurant/profile
// @access  Private (Restaurant owner only)
// Note: findRestaurant is NOT needed here, as we are creating the restaurant, so req.restaurant will be null initially.
router.post('/profile', protect, authorize('restaurant'), async (req, res) => { // findRestaurant explicitly NOT used here
    const { restaurant, owner } = req.body; // Expecting nested objects now

    // Use findOne to check if a restaurant already exists for this owner
    const existingRestaurant = await Restaurant.findOne({ owner: req.user._id });

    if (existingRestaurant) {
        return res.status(400).json({ message: 'You already have a restaurant profile. Use PUT to update it.' });
    }
    const ownerId = req.user._id;

    try {
        const newRestaurant = new Restaurant({
            owner: ownerId,
            title: restaurant.title,
            description: restaurant.description,
            address: restaurant.address,
            image: restaurant.image
        });

        await newRestaurant.save();

        // Update User's name and email if provided in ownerData for consistency
        await User.findByIdAndUpdate(ownerId, {
            name: owner.name,
            email: owner.email
        });

        res.status(201).json({
            message: 'Restaurant profile created successfully!',
            restaurant: newRestaurant,
            owner: { name: owner.name, email: owner.email } // Send back updated owner info
        });

    } catch (error) {
        console.error('Error creating restaurant profile:', error);
        if (error.code === 11000) { // Duplicate key error (due to unique:true on owner)
            return res.status(400).json({ message: 'You have already created a restaurant profile.' });
        }
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error creating restaurant profile.' });
    }
});


// @desc    Update current restaurant's profile details
// @route   PUT /api/restaurant/profile
// @access  Private (Restaurant owner only)
router.put('/profile', async (req, res) => { // findRestaurant middleware has already run
    const { restaurant: restaurantData, owner: ownerData } = req.body; // Expecting nested objects now

    if (!req.restaurant) {
        return res.status(403).json({ message: 'No restaurant profile found to update. Please create one first.' });
    }

    const restaurant = req.restaurant; // Use the restaurant object from middleware
    const ownerId = req.user._id; // The ID of the authenticated user (owner)

    try {
        restaurant.title = restaurantData.title || restaurant.title;
        restaurant.description = restaurantData.description || restaurant.description;
        restaurant.address = restaurantData.address || restaurant.address;
        restaurant.image = restaurantData.image || restaurant.image;

        await restaurant.save();

        // Update User's name and email for consistency
        await User.findByIdAndUpdate(ownerId, {
            name: ownerData.name,
            email: ownerData.email
        });

        res.status(200).json({
            message: 'Restaurant profile updated successfully!',
            restaurant: restaurant,
            owner: { name: ownerData.name, email: ownerData.email } // Send back updated owner info
        });
    } catch (error) {
        console.error('Error updating restaurant profile:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error updating restaurant profile.' });
    }
});

module.exports = router;


