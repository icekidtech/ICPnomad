import mongoose, { Schema, Document } from 'mongoose';

/**
 * IMPORTANT: This MongoDB model is OPTIONAL and NOT required for core functionality.
 * The ICPNomadWallet canister provides all essential storage capabilities.
 * 
 * This model is used only for optional off-chain metadata and does NOT store:
 * - Phone numbers (privacy requirement)
 * - PINs (security requirement)
 * - Any personally identifiable information
 * 
 * All sensitive operations use the canister storage exclusively.
 */

export interface IUserMetadata extends Document {
  walletAddress: string; // Principal address derived from phone+PIN (stored as string)
  pinHash: string; // Hashed PIN for optional caching (same hash as canister)
  createdAt: Date;
  lastActivity: Date;
  metadata: {
    accountType: 'basic' | 'premium'; // Optional account categorization
    preferredLanguage: string; // USSD interface language preference
    timezone: string; // For transaction timestamp display
    isActive: boolean; // Account status flag
    features: string[]; // Enabled features for this user
  };
  analytics: {
    totalTransactions: number; // Cached count for analytics
    lastTransactionDate?: Date; // Last transaction timestamp
    averageTransactionAmount: number; // Analytics data
    ussdSessionCount: number; // USSD session usage statistics
  };
  preferences: {
    notificationsEnabled: boolean; // User preferences
    maxDailyTransactionAmount?: number; // Optional limits
    autoLogoutMinutes: number; // Security preferences
  };
  // Audit fields
  updatedAt: Date;
  version: number; // Document version for optimistic locking
}

const UserMetadataSchema = new Schema<IUserMetadata>({
  walletAddress: {
    type: String,
    required: true,
    unique: true, // Ensures one metadata record per wallet
    index: true, // Efficient lookups
    validate: {
      validator: function(v: string) {
        // Validate Principal format (basic check)
        return /^[a-zA-Z0-9\-]+$/.test(v) && v.length >= 20;
      },
      message: 'Invalid wallet address format'
    }
  },
  pinHash: {
    type: String,
    required: true,
    minlength: 64, // SHA256 hash length
    maxlength: 64
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true // Cannot be changed after creation
  },
  lastActivity: {
    type: Date,
    default: Date.now,
    index: true // For activity-based queries
  },
  metadata: {
    accountType: {
      type: String,
      enum: ['basic', 'premium'],
      default: 'basic'
    },
    preferredLanguage: {
      type: String,
      default: 'en',
      enum: ['en', 'sw', 'fr', 'ar'] // Supported USSD languages
    },
    timezone: {
      type: String,
      default: 'UTC'
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    features: [{
      type: String,
      enum: ['stablecoin', 'transfers', 'savings', 'loans', 'merchant_pay']
    }]
  },
  analytics: {
    totalTransactions: {
      type: Number,
      default: 0,
      min: 0
    },
    lastTransactionDate: {
      type: Date,
      index: true
    },
    averageTransactionAmount: {
      type: Number,
      default: 0,
      min: 0
    },
    ussdSessionCount: {
      type: Number,
      default: 0,
      min: 0
    }
  },
  preferences: {
    notificationsEnabled: {
      type: Boolean,
      default: true
    },
    maxDailyTransactionAmount: {
      type: Number,
      min: 0
    },
    autoLogoutMinutes: {
      type: Number,
      default: 5,
      min: 1,
      max: 60
    }
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: false, // We manage timestamps manually
  collection: 'user_metadata' // Explicit collection name
});

// Indexes for efficient queries
UserMetadataSchema.index({ 'metadata.isActive': 1, lastActivity: -1 });
UserMetadataSchema.index({ 'analytics.totalTransactions': -1 });
UserMetadataSchema.index({ createdAt: -1 });

// Pre-save middleware to update timestamps and version
UserMetadataSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = new Date();
    this.version += 1;
  }
  next();
});

// Static methods for common operations
UserMetadataSchema.statics.findByWalletAddress = function(walletAddress: string) {
  return this.findOne({ walletAddress, 'metadata.isActive': true });
};

UserMetadataSchema.statics.updateLastActivity = function(walletAddress: string) {
  return this.updateOne(
    { walletAddress },
    { 
      lastActivity: new Date(),
      $inc: { 'analytics.ussdSessionCount': 1 }
    }
  );
};

// Instance methods
UserMetadataSchema.methods.incrementTransactionCount = function() {
  this.analytics.totalTransactions += 1;
  this.analytics.lastTransactionDate = new Date();
  this.lastActivity = new Date();
  return this.save();
};

UserMetadataSchema.methods.updateAverageTransactionAmount = function(newAmount: number) {
  const currentAvg = this.analytics.averageTransactionAmount || 0;
  const count = this.analytics.totalTransactions || 1;
  this.analytics.averageTransactionAmount = ((currentAvg * (count - 1)) + newAmount) / count;
  return this.save();
};

// Export the model
export const UserMetadata = mongoose.model<IUserMetadata>('UserMetadata', UserMetadataSchema);

// Type exports for use in services
export type UserMetadataDocument = IUserMetadata;
export type UserMetadataModel = typeof UserMetadata;

/**
 * Usage Notes:
 * 
 * 1. This model is completely optional - the canister provides all core functionality
 * 2. Never store phone numbers or unhashed PINs in this model
 * 3. walletAddress should match the Principal generated by the canister
 * 4. Use this model only for analytics, preferences, and non-sensitive metadata
 * 5. Always verify data consistency with the canister as the source of truth
 * 6. Consider data retention policies for analytics data
 */