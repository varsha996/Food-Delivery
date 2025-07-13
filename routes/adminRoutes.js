// routes/adminRoutes.js
const express = require('express');
const mongoose = require('mongoose');
const { User, Restaurant, Order, FoodItem, FeedbackCustomer, FeedbackRestaurant, FeedbackAdmin, Admin, FeedbackUserToAdmin } = require('../models/schema'); // Import ALL necessary models, ensure FeedbackUserToAdmin is here for totalFeedbackToAdmin
const { protect, authorize } = require('../middleware/auth'); // Import authentication middleware
const router = express.Router();

// Existing routes...

router.get('/dashboard-counts', protect, authorize('admin'), async (req, res) => {
    try {
        const totalUsers = await User.countDocuments();
        const totalRestaurants = await Restaurant.countDocuments();
        const totalOrders = await Order.countDocuments();
        
        // --- ADD THIS LINE FOR TOTAL FOOD ITEMS ---
        const totalFoodItems = await FoodItem.countDocuments(); 

        const pendingApprovals = await User.countDocuments({
            userType: { $in: ['restaurant', 'admin'] }, // Assuming only restaurant and admin need approval
            approval: 'pending'
        });
        
        // --- Add count for totalFeedbackToAdmin if you have FeedbackUserToAdmin model ---
        // Assuming FeedbackUserToAdmin is the model for feedback from users (customers/restaurants) TO admin.
        // If not, adjust this line to count from the correct model.
        const totalFeedbackToAdminCount = await FeedbackUserToAdmin.countDocuments();

        const adminConfig = await Admin.findOne();
        const popularRestaurantsCount = adminConfig ? adminConfig.promotedRestaurants.length : 0;

        res.status(200).json({
            totalUsers,
            totalRestaurants,
            totalOrders,
            totalFoodItems, // --- INCLUDE THIS IN THE RESPONSE ---
            pendingApprovals,
            popularRestaurantsCount,
            totalFeedbackToAdminCount // Include this if you're tracking feedback from users to admin
        });
    } catch (error) {
        console.error('Error fetching admin dashboard counts:', error);
        res.status(500).json({ message: 'Server error fetching dashboard data' });
    }
});

router.get('/users', protect, authorize('admin'), async (req, res) => {
    try {
        const users = await User.find().select('-password');
        res.status(200).json(users);
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Server error fetching users' });
    }
});

router.put('/users/:id/approve', protect, authorize('admin'), async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (user.userType === 'customer') {
            return res.status(400).json({ message: 'Customer accounts do not require explicit approval.' });
        }
        if (user.approval === 'accepted') {
            return res.status(400).json({ message: 'User is already approved.' });
        }
        user.approval = 'accepted';
        await user.save();
        res.status(200).json({ message: `User ${user.name} approved successfully!` });
    } catch (error) {
        console.error('Error approving user:', error);
        res.status(500).json({ message: 'Server error approving user' });
    }
});

router.delete('/users/:id', protect, authorize('admin'), async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        if (req.user._id.toString() === user._id.toString()) {
            return res.status(403).json({ message: 'You cannot delete your own admin account.' });
        }
        if (user.userType === 'admin') {
            return res.status(403).json({ message: 'Cannot delete another admin user directly.' });
        }
        if (user.userType === 'restaurant') {
            const restaurant = await Restaurant.findOne({ owner: user._id });
            if (restaurant) {
                await FoodItem.deleteMany({ restaurant: restaurant._id });
                await Order.deleteMany({ restaurant: restaurant._id }); // Delete related orders
                await FeedbackCustomer.deleteMany({ receiver: restaurant._id }); // Delete related feedback
                await Restaurant.deleteOne({ _id: restaurant._id });
                console.log(`Deleted restaurant, food items, orders, and customer feedback for owner ${user._id}`);
            }
        }
        await User.deleteOne({ _id: req.params.id });
        res.status(200).json({ message: 'User deleted successfully!' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ message: 'Server error deleting user' });
    }
});

router.get('/profile', protect, authorize('admin'), async (req, res) => {
    try {
        res.status(200).json({ user: req.user });
    } catch (error) {
        console.error('Error fetching admin profile:', error);
        res.status(500).json({ message: 'Server error fetching profile data.' });
    }
});

router.put('/profile', protect, authorize('admin'), async (req, res) => {
    const { name, email } = req.body;
    try {
        const user = await User.findById(req.user._id); // Get current user from DB
        if (!user) {
            return res.status(404).json({ message: 'User not found.' });
        }
        if (email && email !== user.email) {
            const emailExists = await User.findOne({ email });
            if (emailExists) {
                return res.status(400).json({ message: 'Email already registered by another user.' });
            }
        }
        user.name = name || user.name;
        user.email = email || user.email;
        await user.save();
        res.status(200).json({
            message: 'Profile updated successfully!',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                userType: user.userType,
                approval: user.approval
            }
        });
    } catch (error) {
        console.error('Error updating admin profile:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: messages.join(', ') });
        }
        res.status(500).json({ message: 'Server error updating profile.' });
    }
});

router.get('/restaurants', protect, authorize('admin'), async (req, res) => {
    try {
        const restaurants = await Restaurant.find().populate('owner', 'name email'); // Populate owner for better context
        res.status(200).json(restaurants);
    } catch (error) {
        console.error('Error fetching restaurants:', error);
        res.status(500).json({ message: 'Server error fetching restaurants' });
    }
});

router.delete('/restaurants/:id', protect, authorize('admin'), async (req, res) => {
    try {
        const restaurantId = req.params.id;
        const restaurant = await Restaurant.findById(restaurantId);
        if (!restaurant) {
            return res.status(404).json({ message: 'Restaurant not found.' });
        }
        await FoodItem.deleteMany({ restaurant: restaurantId });
        await Order.deleteMany({ restaurant: restaurantId });
        await FeedbackCustomer.deleteMany({ receiver: restaurantId });
        await Restaurant.deleteOne({ _id: restaurantId });
        res.status(200).json({ message: 'Restaurant, its menu, orders, and customer feedback deleted successfully!' });
    } catch (error) {
        console.error('Error deleting restaurant:', error);
        res.status(500).json({ message: 'Server error deleting restaurant.' });
    }
});

router.get('/orders', protect, authorize('admin'), async (req, res) => {
    try {
        const orders = await Order.find()
            .populate('user', 'name email')
            .populate('restaurant', 'title address')
            .populate('items.foodItem', 'title price'); // Populate food item details within items array
        res.status(200).json(orders);
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).json({ message: 'Server error fetching orders' });
    }
});

router.get('/categories', protect, authorize('admin'), async (req, res) => {
    try {
        const admin = await Admin.findOne(); // Or find specific admin if applicable
        if (!admin) {
            return res.status(200).json([]);
        }
        res.status(200).json(admin.categories || []);
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ message: 'Server error fetching categories.' });
    }
});

router.post('/categories', protect, authorize('admin'), async (req, res) => {
    const { name } = req.body;
    if (!name || name.trim() === '') {
        return res.status(400).json({ message: 'Category name is required and cannot be empty.' });
    }
    const categoryName = name.trim();
    try {
        let admin = await Admin.findOne();
        if (!admin) {
            admin = new Admin({ categories: [] });
        }
        if (admin.categories.includes(categoryName)) {
            return res.status(400).json({ message: 'Category already exists.' });
        }
        admin.categories.push(categoryName);
        await admin.save();
        res.status(201).json({ message: 'Category added successfully!', categories: admin.categories });
    } catch (error) {
        console.error('Error adding category:', error);
        res.status(500).json({ message: 'Server error adding category.' });
    }
});

router.put('/categories/:oldName', protect, authorize('admin'), async (req, res) => {
    const oldName = req.params.oldName;
    const { newName } = req.body;
    if (!newName || newName.trim() === '') {
        return res.status(400).json({ message: 'New category name is required and cannot be empty.' });
    }
    const trimmedNewName = newName.trim();
    try {
        const admin = await Admin.findOne();
        if (!admin) {
            return res.status(404).json({ message: 'Admin configuration not found.' });
        }
        const categoryIndex = admin.categories.indexOf(oldName);
        if (categoryIndex === -1) {
            return res.status(404).json({ message: 'Original category not found.' });
        }
        if (admin.categories.includes(trimmedNewName) && oldName !== trimmedNewName) {
            return res.status(400).json({ message: 'New category name already exists.' });
        }
        admin.categories[categoryIndex] = trimmedNewName;
        await admin.save();
        res.status(200).json({ message: 'Category updated successfully!', categories: admin.categories });
    } catch (error) {
        console.error('Error updating category:', error);
        res.status(500).json({ message: 'Server error updating category.' });
    }
});

router.delete('/categories/:name', protect, authorize('admin'), async (req, res) => {
    const categoryName = req.params.name;
    try {
        const admin = await Admin.findOne();
        if (!admin) {
            return res.status(404).json({ message: 'Admin configuration not found.' });
        }
        const initialLength = admin.categories.length;
        admin.categories = admin.categories.filter(cat => cat !== categoryName);

        if (admin.categories.length === initialLength) {
            return res.status(404).json({ message: 'Category not found.' });
        }
        await admin.save();
        res.status(200).json({ message: 'Category deleted successfully!', categories: admin.categories });
    } catch (error) {
        console.error('Error deleting category:', error);
        res.status(500).json({ message: 'Server error deleting category.' });
    }
});

router.get('/feedbacks/customer', protect, authorize('admin'), async (req, res) => {
    try {
        const feedback = await FeedbackCustomer.find()
            .populate('user', 'name email') // Populate user who gave feedback
            .populate('receiver', 'title'); // Populate restaurant that received feedback
        res.status(200).json(feedback);
    } catch (error) {
        console.error('Error fetching customer feedback:', error);
        res.status(500).json({ message: 'Server error fetching customer feedback' });
    }
});

router.get('/feedbacks/restaurant', protect, authorize('admin'), async (req, res) => {
    try {
        const feedback = await FeedbackRestaurant.find()
            .populate('restaurant', 'title'); // Populate restaurant that sent feedback
        res.status(200).json(feedback);
    } catch (error) {
        console.error('Error fetching restaurant feedback:', error);
        res.status(500).json({ message: 'Server error fetching restaurant feedback' });
    }
});

router.put('/feedbacks/restaurant/:id/resolve', protect, authorize('admin'), async (req, res) => {
    try {
        const feedback = await FeedbackRestaurant.findById(req.params.id);
        if (!feedback) {
            return res.status(404).json({ message: 'Feedback not found.' });
        }
        if (feedback.status === 'resolved') {
            return res.status(400).json({ message: 'Feedback is already resolved.' });
        }
        feedback.status = 'resolved';
        await feedback.save();
        res.status(200).json({ message: 'Feedback marked as resolved successfully!' });
    } catch (error) {
        console.error('Error resolving feedback:', error);
        res.status(500).json({ message: 'Server error resolving feedback.' });
    }
});

router.get('/feedbacks/admin', protect, authorize('admin'), async (req, res) => {
    try {
        const feedback = await FeedbackAdmin.find()
            .populate('admin', 'name email'); // Populate admin who sent it
        res.status(200).json(feedback);
    } catch (error) {
        console.error('Error fetching admin feedback:', error);
        res.status(500).json({ message: 'Server error fetching admin feedback' });
    }
});

// This route will retrieve all feedback from FeedbackRestaurant.
// If you implement a separate FeedbackUserToAdmin model, this route would be updated.
router.get('/feedback/user', protect, authorize('admin'), async (req, res) => {
    try {
        // For now, let's assume 'Feedback (User)' is primarily about
        // feedback from restaurant owners to admin (which is already FeedbackRestaurant)
        // or a general user feedback.
        // If you need actual customer-to-admin feedback, you'd need a new model for it.
        const feedback = await FeedbackRestaurant.find()
            .populate('restaurant', 'title'); // Populate the restaurant (sender)

        // Map to the format expected by the frontend's renderUserFeedbackTable
        const formattedFeedback = feedback.map(f => ({
            _id: f._id,
            sender: {
                name: f.restaurant ? f.restaurant.title : 'N/A', // Restaurant title as sender name
                userType: 'restaurant' // Assuming these are from restaurant users
            },
            message: f.message,
            status: f.status,
            createdAt: f.createdAt,
            // Additional fields needed by frontend are implicitly handled or set to N/A
        }));

        res.status(200).json(formattedFeedback);
    } catch (error) {
        console.error('Error fetching user feedback for admin (combined view):', error);
        res.status(500).json({ message: 'Server error fetching user feedback' });
    }
});

router.put('/feedback/user/:id/status', protect, authorize('admin'), async (req, res) => {
    const { status } = req.body;
    try {
        const feedback = await FeedbackRestaurant.findById(req.params.id);
        if (!feedback) {
            return res.status(404).json({ message: 'Feedback not found.' });
        }
        if (!['new', 'pending', 'resolved'].includes(status)) {
            return res.status(400).json({ message: 'Invalid status provided.' });
        }
        feedback.status = status;
        await feedback.save();
        res.status(200).json({ message: `Feedback status updated to ${status} successfully!` });
    } catch (error) {
        console.error('Error updating user feedback status:', error);
        res.status(500).json({ message: 'Server error updating feedback status.' });
    }
});

router.post('/feedbacks/admin/send', protect, authorize('admin'), async (req, res) => {
    // Get message, type, receiverRole, and optional receiver (which holds the ID) from request body
    const { message, type, receiverRole, receiver } = req.body;

    // The admin's ID is reliably available from req.user after 'protect' middleware
    const adminIdFromToken = req.user._id;

    // Basic validation
    if (!message || message.trim() === '') {
        return res.status(400).json({ message: 'Message cannot be empty.' });
    }
    if (!type || !['Announcement', 'Warning', 'Information', 'Other'].includes(type)) {
        return res.status(400).json({ message: 'Invalid message type provided.' });
    }
    // Receiver role validation will now be handled by Mongoose enum, but good to have a check here too
    if (!receiverRole || !['allUsers', 'allRestaurants', 'specificUser', 'specificRestaurant'].includes(receiverRole)) { // Matches schema
        return res.status(400).json({ message: 'Invalid receiver role provided.' });
    }

    try {
        const feedbackData = {
            admin: adminIdFromToken,
            message: message.trim(),
            type: type,
            receiverRole: receiverRole
        };

        if (receiverRole === 'specificUser') {
            if (!receiver || receiver.trim() === '') {
                return res.status(400).json({ message: 'User ID is required for Specific User role.' });
            }
            if (!mongoose.Types.ObjectId.isValid(receiver)) {
                return res.status(400).json({ message: 'Invalid User ID format.' });
            }
            const targetUser = await User.findById(receiver);
            if (!targetUser) {
                return res.status(404).json({ message: 'Specific user not found.' });
            }
            if (targetUser.userType !== 'customer' && targetUser.userType !== 'restaurant') { // Assuming specificUser can be customer or restaurant owner
                return res.status(400).json({ message: 'Target user is not a customer or restaurant owner type.' });
            }
            feedbackData.receiver = receiver; // Store the User's ObjectId
        } else if (receiverRole === 'specificRestaurant') {
            if (!receiver || receiver.trim() === '') {
                return res.status(400).json({ message: 'Restaurant ID is required for Specific Restaurant role.' });
            }
            if (!mongoose.Types.ObjectId.isValid(receiver)) {
                return res.status(400).json({ message: 'Invalid Restaurant ID format.' });
            }
            // Find the restaurant to get its owner's ID
            const targetRestaurant = await Restaurant.findById(receiver).populate('owner');
            if (!targetRestaurant) {
                return res.status(404).json({ message: 'Specific restaurant not found.' });
            }
            if (!targetRestaurant.owner) {
                return res.status(404).json({ message: 'Target restaurant has no associated owner user.' });
            }
            // Assign the Restaurant Owner's User ID to the receiver field
            feedbackData.receiver = targetRestaurant.owner._id; 
        } else { // 'allUsers' or 'allRestaurants'
            feedbackData.receiver = null; // Ensure receiver is null if not specific
        }

        const newFeedbackAdmin = new FeedbackAdmin(feedbackData);
        await newFeedbackAdmin.save();

        res.status(201).json({ message: 'Announcement/Feedback sent successfully!', data: newFeedbackAdmin });
    } catch (error) {
        console.error('Error sending admin feedback:', error);
        if (error.name === 'ValidationError') {
            const messages = Object.values(error.errors).map(val => val.message);
            return res.status(400).json({ message: `Validation Error: ${messages.join(', ')}` });
        }
        if (error.name === 'CastError') {
            // This might occur if a non-ObjectId string is passed where ObjectId is expected
            return res.status(400).json({ message: `Invalid ID format for: ${error.path}. Please provide a valid ID.` });
        }
        res.status(500).json({ message: 'Server error sending admin feedback.' });
    }
});

router.get('/promoted-restaurants', protect, authorize('admin'), async (req, res) => {
    try {
        const adminConfig = await Admin.findOne().populate('promotedRestaurants', 'title image address'); // Populate actual restaurant details
        if (!adminConfig) {
            return res.status(200).json({ promotedRestaurants: [], message: 'No admin config found, no promoted restaurants.' });
        }
        res.status(200).json({ promotedRestaurants: adminConfig.promotedRestaurants });
    } catch (error) {
        console.error('Error fetching promoted restaurants:', error);
        res.status(500).json({ message: 'Server error fetching promoted restaurants.' });
    }
});

router.put('/promoted-restaurants', protect, authorize('admin'), async (req, res) => {
    const { restaurantIds } = req.body; // Expecting an array of restaurant IDs
    try {
        let adminConfig = await Admin.findOne();

        if (!adminConfig) {
            adminConfig = new Admin({ promotedRestaurants: [] });
        }

        // Validate if all provided IDs are valid restaurants
        const validRestaurants = await Restaurant.find({ _id: { $in: restaurantIds } });
        const validRestaurantIds = validRestaurants.map(r => r._id.toString());

        // Update the promotedRestaurants array with only valid and unique IDs
        adminConfig.promotedRestaurants = [...new Set(validRestaurantIds)];
        await adminConfig.save();

        res.status(200).json({ message: 'Promoted restaurants updated successfully!', promotedRestaurants: adminConfig.promotedRestaurants });

    } catch (error) {
        console.error('Error updating promoted restaurants:', error);
        res.status(500).json({ message: 'Server error updating promoted restaurants.' });
    }
});

// @desc    Get overall metrics for reports dashboard
// @route   GET /api/admin/reports/metrics
// @access  Private (Admin only)
router.get('/reports/metrics', async (req, res) => {
    const { startDate, endDate } = req.query;
    let queryFilter = {};

    if (startDate && endDate) {
        queryFilter.orderDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    try {
        // Total Revenue (from delivered orders)
        const deliveredOrders = await Order.find({ ...queryFilter, status: 'delivered' });
        const totalRevenue = deliveredOrders.reduce((sum, order) => sum + order.totalAmount, 0);

        // Average Delivery Time (from delivered orders with deliveryTimeMinutes)
        const deliveredOrdersWithTime = deliveredOrders.filter(order => typeof order.deliveryTimeMinutes === 'number');
        const totalDeliveryTime = deliveredOrdersWithTime.reduce((sum, order) => sum + order.deliveryTimeMinutes, 0);
        const averageDeliveryTime = deliveredOrdersWithTime.length > 0 ? totalDeliveryTime / deliveredOrdersWithTime.length : null;

        // Cancellation Rate
        const totalOrdersInPeriod = await Order.countDocuments(queryFilter);
        const cancelledOrdersInPeriod = await Order.countDocuments({ ...queryFilter, status: 'cancelled' });
        const cancellationRate = totalOrdersInPeriod > 0 ? (cancelledOrdersInPeriod / totalOrdersInPeriod) * 100 : 0;

        res.status(200).json({
            totalRevenue: totalRevenue,
            averageDeliveryTime: averageDeliveryTime,
            cancellationRate: cancellationRate
        });

    } catch (error) {
        console.error('Error fetching report metrics:', error);
        res.status(500).json({ message: 'Server error fetching report metrics.' });
    }
});

// @desc    Get order volume trend for line chart
// @route   GET /api/admin/reports/order-trend
// @access  Private (Admin only)
router.get('/reports/order-trend', async (req, res) => {
    const { startDate, endDate } = req.query;
    let queryMatch = {};

    if (startDate && endDate) {
        queryMatch.orderDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    try {
        const orderTrend = await Order.aggregate([
            { $match: queryMatch },
            {
                $group: {
                    _id: {
                        year: { $year: "$orderDate" },
                        month: { $month: "$orderDate" },
                        day: { $dayOfMonth: "$orderDate" }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $project: {
                    _id: 0,
                    date: {
                        $dateToString: {
                            format: "%Y-%m-%d",
                            date: {
                                $dateFromParts: {
                                    year: "$_id.year",
                                    month: "$_id.month",
                                    day: "$_id.day"
                                }
                            }
                        }
                    },
                    order_count: "$count"
                }
            },
            { $sort: { date: 1 } }
        ]);

        const labels = orderTrend.map(item => item.date);
        const data = orderTrend.map(item => item.order_count);

        res.status(200).json({
            labels: labels,
            datasets: [{
                label: 'Number of Orders',
                data: data,
                fill: false,
                borderColor: 'rgb(75, 192, 192)',
                tension: 0.1
            }]
        });

    } catch (error) {
        console.error('Error fetching order trend data:', error);
        res.status(500).json({ message: 'Server error fetching order trend.' });
    }
});

// @desc    Get top restaurants by order count and average rating
// @route   GET /api/admin/reports/top-restaurants
// @access  Private (Admin only)
router.get('/reports/top-restaurants', async (req, res) => {
    const { startDate, endDate } = req.query;
    let queryMatch = {};

    if (startDate && endDate) {
        queryMatch.orderDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    try {
        // Aggregate orders by restaurant
        const topRestaurantsAggregation = await Order.aggregate([
            { $match: { ...queryMatch, status: 'delivered' } }, // Only delivered orders for sales metrics
            {
                $group: {
                    _id: "$restaurant",
                    totalOrders: { $sum: 1 }
                }
            },
            { $sort: { totalOrders: -1 } },
            { $limit: 5 }, // Top 5 restaurants
            {
                $lookup: {
                    from: 'restaurants', // The collection name for Restaurant model
                    localField: '_id',
                    foreignField: '_id',
                    as: 'restaurantDetails'
                }
            },
            { $unwind: '$restaurantDetails' },
            {
                $project: {
                    _id: 0,
                    restaurantId: '$_id',
                    name: '$restaurantDetails.title',
                    orders: '$totalOrders',
                    averageRating: '$restaurantDetails.averageRating' // Assuming averageRating is stored on the Restaurant model
                }
            }
        ]);

        const formattedResult = topRestaurantsAggregation.map((rest, index) => ({
            rank: index + 1,
            name: rest.name,
            orders: rest.orders,
            rating: rest.averageRating || 0 // Default to 0 if no rating or field doesn't exist
        }));

        res.status(200).json(formattedResult);

    } catch (error) {
        console.error('Error fetching top restaurants data:', error);
        res.status(500).json({ message: 'Server error fetching top restaurants.' });
    }
});

// @desc    Get food category popularity for pie chart
// @route   GET /api/admin/reports/category-popularity
// @access  Private (Admin only)
router.get('/reports/category-popularity', async (req, res) => {
    const { startDate, endDate } = req.query;
    let queryMatch = {};

    if (startDate && endDate) {
        queryMatch.orderDate = {
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    try {
        const categoryPopularity = await Order.aggregate([
            { $match: queryMatch },
            { $unwind: '$items' }, // Deconstruct the items array
            {
                $lookup: {
                    from: 'fooditems', // The collection name for FoodItem model
                    localField: 'items.foodItem',
                    foreignField: '_id',
                    as: 'foodItemDetails'
                }
            },
            { $unwind: '$foodItemDetails' },
            {
                $group: {
                    _id: '$foodItemDetails.category',
                    count: { $sum: '$items.quantity' } // Sum quantities for more accurate popularity
                }
            },
            {
                $project: {
                    _id: 0,
                    category: '$_id',
                    count: 1
                }
            },
            { $sort: { count: -1 } }
        ]);

        const labels = categoryPopularity.map(item => item.category);
        const data = categoryPopularity.map(item => item.count);

        // Generate random colors for the pie chart
        const backgroundColors = data.map(() => `hsl(${Math.random() * 360}, 70%, 70%)`);

        res.status(200).json({
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: backgroundColors,
                hoverOffset: 4
            }]
        });

    } catch (error) {
        console.error('Error fetching category popularity data:', error);
        res.status(500).json({ message: 'Server error fetching category popularity.' });
    }
});

// @desc    Get customer feedback rating distribution for bar chart
// @route   GET /api/admin/reports/rating-distribution
// @access  Private (Admin only)
router.get('/reports/rating-distribution', async (req, res) => {
    const { startDate, endDate } = req.query;
    let queryMatch = {};

    if (startDate && endDate) {
        queryMatch.createdAt = { // Assuming 'createdAt' field for feedback timestamps
            $gte: new Date(startDate),
            $lte: new Date(endDate)
        };
    }

    try {
        const ratingDistribution = await FeedbackCustomer.aggregate([
            { $match: queryMatch },
            {
                $group: {
                    _id: "$rating",
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }, // Sort by rating (1-5)
            {
                $project: {
                    _id: 0,
                    rating: "$_id",
                    count: 1
                }
            }
        ]);

        // Ensure all ratings from 1 to 5 are present, even if count is 0
        const allRatings = [1, 2, 3, 4, 5];
        const ratingMap = new Map(ratingDistribution.map(item => [item.rating, item.count]));

        const labels = allRatings.map(String); // Labels for 1, 2, 3, 4, 5
        const data = allRatings.map(rating => ratingMap.get(rating) || 0); // Get count, or 0 if no ratings for that value

        res.status(200).json({
            labels: labels,
            datasets: [{
                label: 'Number of Ratings',
                data: data,
                backgroundColor: ['#f44336', '#ff9800', '#ffeb3b', '#8bc34a', '#4caf50'], // Colors for 1-5 stars
                borderColor: ['#d32f2f', '#f57c00', '#fbc02d', '#689f38', '#388e3c'],
                borderWidth: 1
            }]
        });

    } catch (error) {
        console.error('Error fetching rating distribution data:', error);
        res.status(500).json({ message: 'Server error fetching rating distribution.' });
    }
});



module.exports = router;


