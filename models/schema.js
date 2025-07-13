// models/schema.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // Add bcrypt for password hashing

// 🧑 User Schema
const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please add a name'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please add an email'],
    unique: true,
    match: [
      /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/,
      'Please add a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please add a password'],
    minlength: 6,
    select: false // This prevents the password from being returned by default queries
  },
  userType: {
    type: String,
    enum: ['admin', 'restaurant', 'customer'],
    default: 'customer'
  },
  approval: {
    type: String,
    enum: ['pending', 'accepted', 'rejected'], // Added 'rejected' for clarity
    default: 'pending' // Only relevant for restaurant and admin, customer is auto-approved
  },
  address: { // New: Customer's address
    type: String,
    trim: true,
    maxlength: [200, 'Address can not be more than 200 characters'],
    default: '' // Default to empty string if not provided
  },
  phone: { // New: Customer's phone number
    type: String,
    trim: true,
    maxlength: [20, 'Phone number can not be more than 20 characters'],
    default: '' // Default to empty string if not provided
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});

// Hash password before saving to database
UserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) { // Only hash if password is new or modified
    next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Method to compare entered password with hashed password in DB
UserSchema.methods.matchPassword = async function(enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};


// 👑 Admin Schema (for site-wide configuration, not an individual admin user)
const AdminSchema = new mongoose.Schema({
  categories: { // Global list of food categories
    type: [String],
    default: ['Indian', 'Chinese', 'Italian', 'Mexican', 'Fast Food', 'Desserts', 'Beverages']
  },
  promotedRestaurants: [ // List of restaurant IDs to be promoted on customer dashboard
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Restaurant'
    }
  ]
}, { timestamps: true });


// 🍽 Restaurant Schema
const RestaurantSchema = new mongoose.Schema({
  owner: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // A user can only own one restaurant
  },
  title: {
    type: String,
    required: [true, 'Please add a restaurant title'],
    trim: true,
    maxlength: [100, 'Title can not be more than 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description can not be more than 500 characters']
  },
  address: {
    type: String,
    required: [true, 'Please add an address'],
    maxlength: [200, 'Address can not be more than 200 characters']
  },
  image: {
    type: String,
    default: 'https://placehold.co/400x300/E0E0E0/888888?text=Restaurant+Image'
  },
  averageRating: { // Calculated from customer feedback
    type: Number,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating can not be more than 5'],
    default: null // Null if no ratings yet
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});


// 🧆 FoodItem/Menu Schema
const FoodItemSchema = new mongoose.Schema({
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  title: {
    type: String,
    required: [true, 'Please add a food item title'],
    trim: true,
    maxlength: [100, 'Title can not be more than 100 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description can not be more than 500 characters']
  },
  image: {
    type: String,
    default: 'https://placehold.co/400x200/E0E0E0/888888?text=Food+Item'
  },
  category: {
    type: String,
    required: [true, 'Please select a category'],
    trim: true
  },
  price: {
    type: Number,
    required: [true, 'Please add a price'],
    min: [0, 'Price cannot be negative']
  },
  discount: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  rating: { // Average rating for this specific food item (can be calculated or left null)
    type: Number,
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating can not be more than 5'],
    default: null
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});


// 🛒 Cart Schema (One cart per user, can hold items from multiple restaurants)
const CartSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true // A user can only have one cart
  },
  items: [
    {
      foodItem: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'FoodItem',
        required: true
      },
      quantity: {
        type: Number,
        required: true,
        min: [1, 'Quantity must be at least 1']
      },
      priceAtTimeOfAddition: { // Store the price when item was added to cart
        type: Number,
        required: true
      },
      restaurant: { // Store the restaurant ID for this cart item
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Restaurant',
        required: true
      },
      addedAt: { // Timestamp for when this specific item was added/updated in cart
        type: Date,
        default: Date.now
      }
    }
  ]
}, {
  timestamps: true // Adds createdAt and updatedAt for the cart document itself
});


// 📦 Order Schema
const OrderSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  restaurant: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  items: [{
    foodItem: { // Reference to the actual food item
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FoodItem',
      required: true
    },
    quantity: {
      type: Number,
      required: true,
      min: [1, 'Quantity must be at least 1']
    },
    price: { // Price at the time of order (discounted price)
      type: Number,
      required: true
    },
    discount: { // Discount applied at time of order
      type: Number,
      default: 0
    }
  }],
  totalAmount: { // Calculated total amount of the order
    type: Number,
    min: 0 // Removed required: true
  },
  orderDate: {
    type: Date,
    default: Date.now
  },
  status: {
    type: String,
    enum: ['pending', 'preparing', 'delivered', 'cancelled'],
    default: 'pending'
  },
  paymentMethod: { // Consistent with frontend: COD or Card
    type: String,
    enum: ['COD', 'Card'],
    default: 'COD'
  },
  deliveryAddress: { // New: Optional delivery address for the order
    type: String,
    trim: true,
    maxlength: [200, 'Delivery address can not be more than 200 characters']
  }
}, {
  timestamps: true // Adds createdAt and updatedAt for the order document
});

// Pre-save hook to calculate totalAmount for an order
OrderSchema.pre('save', function(next) {
  this.totalAmount = this.items.reduce((acc, item) => {
    // Assuming 'price' in items array is already the effective price after discount for the order
    return acc + (item.price * item.quantity);
  }, 0);
  next();
});


// 💬 Feedback from Customer to Restaurant (Ratings)
const FeedbackCustomerSchema = new mongoose.Schema({
  user: { // Customer who gave the feedback
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiver: { // Restaurant that received the feedback
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  order: { // Optional: Link to a specific order
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order'
  },
  foodItem: { // NEW: Link to a specific food item being rated
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FoodItem',
    // It's recommended to be required if this feedback is specifically for an item.
    // Make it required if every customer feedback MUST be for a specific food item.
    // If feedback can be general for a restaurant OR specific for an item, make it optional.
    // For now, let's make it optional to allow general restaurant reviews too.
    required: false
  },
  rating: {
    type: Number,
    required: [true, 'Please provide a rating'],
    min: [1, 'Rating must be at least 1'],
    max: [5, 'Rating can not be more than 5']
  },
  message: {
    type: String,
    maxlength: [500, 'Message can not be more than 500 characters']
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});

// Index to ensure a user can only rate a specific order once (optional, but good practice)
// Consider adding an index for foodItem and user for unique item ratings
FeedbackCustomerSchema.index({ user: 1, foodItem: 1 }, { unique: true, partialFilterExpression: { foodItem: { $exists: true, $ne: null } } });


// Post-save hook for customer feedback to update restaurant's average rating
FeedbackCustomerSchema.post('save', async function() {
  const FeedbackCustomer = this.constructor; // Get the model from this instance
  const restaurantId = this.receiver;
  const foodItemId = this.foodItem; // Get the foodItem ID

  // Update Restaurant Average Rating
  const restaurantStats = await FeedbackCustomer.aggregate([
    {
      $match: { receiver: restaurantId, rating: { $exists: true, $ne: null } }
    },
    {
      $group: {
        _id: '$receiver',
        averageRating: { $avg: '$rating' }
      }
    }
  ]);

  try {
    await mongoose.model('Restaurant').findByIdAndUpdate(restaurantId, {
      averageRating: restaurantStats.length > 0 ? restaurantStats[0].averageRating : null
    });
  } catch (err) {
    console.error('Error updating restaurant average rating:', err);
  }

  // NEW: Update FoodItem Average Rating if foodItem is present
  if (foodItemId) {
    const foodItemStats = await FeedbackCustomer.aggregate([
      {
        $match: { foodItem: foodItemId, rating: { $exists: true, $ne: null } }
      },
      {
        $group: {
          _id: '$foodItem',
          averageRating: { $avg: '$rating' }
        }
      }
    ]);

    try {
      await mongoose.model('FoodItem').findByIdAndUpdate(foodItemId, {
        rating: foodItemStats.length > 0 ? foodItemStats[0].averageRating : null
      });
    } catch (err) {
      console.error('Error updating food item average rating:', err);
    }
  }
});

// 💬 Feedback from Restaurant to Admin
const FeedbackRestaurantSchema = new mongoose.Schema({
  restaurant: { // Restaurant that sent the feedback
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Restaurant',
    required: true
  },
  admin: { // Optional: Specific admin user to address
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Reference to Admin User type
  },
  message: {
    type: String,
    required: [true, 'Please provide a message'],
    maxlength: [500, 'Message can not be more than 500 characters']
  },
  status: {
    type: String,
    enum: ['new', 'pending', 'resolved'],
    default: 'new'
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});


// 📢 Feedback/Offer from Admin (Announcements/Notifications initiated by Admin)
const FeedbackAdminSchema = new mongoose.Schema({
  admin: { // Admin who sent the feedback/announcement
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  receiverRole: { // Target role: 'customer', 'restaurant', 'all'
    type: String,
    enum: ['allUsers', 'allRestaurants', 'specificUser', 'specificRestaurant'],
    required: true
  },
  receiver: { // Specific user ID if not 'all' (can be null for 'all')
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  message: {
    type: String,
    required: [true, 'Please provide a message'],
    maxlength: [1000, 'Message can not be more than 1000 characters']
  },
  type: { // e.g., 'announcement', 'warning', 'stock_update'
    type: String,
    default: 'announcement'
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});

// 💬 NEW: Feedback from any User (Customer/Restaurant/Admin) to Admin
const FeedbackUserToAdminSchema = new mongoose.Schema({
  sender: { // The user who sent the feedback (can be customer, restaurant, or admin themselves)
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  message: {
    type: String,
    required: [true, 'Please provide a message'],
    maxlength: [500, 'Message can not be more than 500 characters']
  },
  status: { // Admin can mark this feedback as new, pending, resolved
    type: String,
    enum: ['new', 'pending', 'resolved'],
    default: 'new'
  }
}, {
  timestamps: true // Adds createdAt and updatedAt fields automatically
});


// Export all models
exports.User = mongoose.model('User', UserSchema);
exports.Admin = mongoose.model('Admin', AdminSchema);
exports.Restaurant = mongoose.model('Restaurant', RestaurantSchema);
exports.FoodItem = mongoose.model('FoodItem', FoodItemSchema);
exports.Cart = mongoose.model('Cart', CartSchema);
exports.Order = mongoose.model('Order', OrderSchema);
exports.FeedbackCustomer = mongoose.model('FeedbackCustomer', FeedbackCustomerSchema);
exports.FeedbackRestaurant = mongoose.model('FeedbackRestaurant', FeedbackRestaurantSchema);
exports.FeedbackAdmin = mongoose.model('FeedbackAdmin', FeedbackAdminSchema);
exports.FeedbackUserToAdmin = mongoose.model('FeedbackUserToAdmin', FeedbackUserToAdminSchema); // Export the new model

