import mongoose, { Schema, Document } from 'mongoose';

/**
 * IMPORTANT: This MongoDB model is OPTIONAL and NOT required for core functionality.
 * The ICPNomadWallet canister maintains the authoritative transaction history.
 * 
 * This model is used only for:
 * - Transaction analytics and reporting
 * - Search and filtering capabilities
 * - Audit trails and compliance
 * - Performance optimization for queries
 * 
 * NEVER store sensitive data or use this as the primary transaction record.
 */

// Base interface without methods
interface ITransactionLogBase {
  // Canister transaction reference
  canisterTransactionId: number; // Maps to canister transaction ID
  walletAddress: string; // Principal address involved in transaction
  
  // Transaction details
  transactionType: 'deposit' | 'withdrawal' | 'transfer' | 'stablecoinDeposit' | 'stablecoinWithdrawal' | 'stablecoinTransfer';
  tokenType: 'ICP' | 'STABLECOIN';
  amount: string; // Stored as string to avoid precision issues
  
  // Transaction parties (using wallet addresses, never phone numbers)
  fromAddress?: string; // Sender wallet address (optional for deposits)
  toAddress?: string; // Recipient wallet address (optional for withdrawals)
  
  // Status and timing
  status: 'pending' | 'completed' | 'failed' | 'cancelled';
  timestamp: Date; // Transaction timestamp from canister
  blockIndex?: number; // ICP blockchain block reference (if available)
  
  // Metadata and context
  metadata: {
    source: 'ussd' | 'api' | 'admin' | 'system'; // How transaction was initiated
    sessionId?: string; // USSD session ID or API request ID
    userAgent?: string; // For API requests
    ipAddress?: string; // For API requests (hashed)
    description?: string; // Transaction description
    reference?: string; // External reference number
  };
  
  // Signature and security
  signature?: string; // Transaction signature (if available)
  signatureValid?: boolean; // Signature verification result
  
  // Fees and costs (ICP reverse gas model means fees are usually 0 for users)
  fees: {
    icpFee: string; // ICP transaction fee (usually 0 for users)
    gasFee: string; // Gas fee (usually 0 due to reverse gas model)
    processingFee: string; // Any processing fees
    totalFee: string; // Total fees paid
  };
  
  // Error handling
  errorCode?: string; // Error code if transaction failed
  errorMessage?: string; // Error description if transaction failed
  retryCount: number; // Number of retry attempts
  
  // Analytics and compliance
  analytics: {
    transactionSize: 'micro' | 'small' | 'medium' | 'large' | 'xlarge'; // Amount category
    timeOfDay: 'morning' | 'afternoon' | 'evening' | 'night'; // When transaction occurred
    dayOfWeek: 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';
    riskScore: number; // 0-100, for fraud detection
    flagged: boolean; // Whether transaction was flagged for review
    reviewStatus?: 'pending' | 'approved' | 'rejected';
  };
  
  // Audit trail
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

// Methods interface
interface ITransactionLogMethods {
  calculateAnalytics(): void;
  markCompleted(): Promise<ITransactionLog>;
  markFailed(errorCode: string, errorMessage: string): Promise<ITransactionLog>;
}

// Combined interface
export interface ITransactionLog extends Document, ITransactionLogBase, ITransactionLogMethods {}

const TransactionLogSchema = new Schema<ITransactionLog>({
  canisterTransactionId: {
    type: Number,
    required: true,
    index: true,
    min: 1
  },
  walletAddress: {
    type: String,
    required: true,
    index: true,
    validate: {
      validator: function(v: string) {
        return /^[a-zA-Z0-9\-]+$/.test(v) && v.length >= 20;
      },
      message: 'Invalid wallet address format'
    }
  },
  transactionType: {
    type: String,
    required: true,
    enum: ['deposit', 'withdrawal', 'transfer', 'stablecoinDeposit', 'stablecoinWithdrawal', 'stablecoinTransfer'],
    index: true
  },
  tokenType: {
    type: String,
    required: true,
    enum: ['ICP', 'STABLECOIN'],
    index: true
  },
  amount: {
    type: String,
    required: true,
    validate: {
      validator: function(v: string) {
        return /^\d+$/.test(v) && parseInt(v) > 0;
      },
      message: 'Invalid amount format'
    }
  },
  fromAddress: {
    type: String,
    index: true,
    validate: {
      validator: function(v: string | undefined) {
        return !v || (/^[a-zA-Z0-9\-]+$/.test(v) && v.length >= 20);
      },
      message: 'Invalid from address format'
    }
  },
  toAddress: {
    type: String,
    index: true,
    validate: {
      validator: function(v: string | undefined) {
        return !v || (/^[a-zA-Z0-9\-]+$/.test(v) && v.length >= 20);
      },
      message: 'Invalid to address format'
    }
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true
  },
  timestamp: {
    type: Date,
    required: true,
    index: true
  },
  blockIndex: {
    type: Number,
    index: true,
    min: 0
  },
  metadata: {
    source: {
      type: String,
      required: true,
      enum: ['ussd', 'api', 'admin', 'system'],
      default: 'ussd',
      index: true
    },
    sessionId: {
      type: String,
      maxlength: 100
    },
    userAgent: {
      type: String,
      maxlength: 200
    },
    ipAddress: {
      type: String,
      maxlength: 64 // For hashed IP addresses
    },
    description: {
      type: String,
      maxlength: 500
    },
    reference: {
      type: String,
      maxlength: 100,
      index: true
    }
  },
  signature: {
    type: String,
    maxlength: 200
  },
  signatureValid: {
    type: Boolean,
    index: true
  },
  fees: {
    icpFee: {
      type: String,
      default: '0'
    },
    gasFee: {
      type: String,
      default: '0'
    },
    processingFee: {
      type: String,
      default: '0'
    },
    totalFee: {
      type: String,
      default: '0'
    }
  },
  errorCode: {
    type: String,
    maxlength: 50
  },
  errorMessage: {
    type: String,
    maxlength: 500
  },
  retryCount: {
    type: Number,
    default: 0,
    min: 0,
    max: 10
  },
  analytics: {
    transactionSize: {
      type: String,
      enum: ['micro', 'small', 'medium', 'large', 'xlarge'],
      index: true
    },
    timeOfDay: {
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night'],
      index: true
    },
    dayOfWeek: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
      index: true
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true
    },
    flagged: {
      type: Boolean,
      default: false,
      index: true
    },
    reviewStatus: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      index: true
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true,
    index: true
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
  timestamps: false,
  collection: 'transaction_logs'
});

// Compound indexes for common query patterns
TransactionLogSchema.index({ walletAddress: 1, timestamp: -1 });
TransactionLogSchema.index({ transactionType: 1, tokenType: 1, timestamp: -1 });
TransactionLogSchema.index({ status: 1, timestamp: -1 });
TransactionLogSchema.index({ 'analytics.flagged': 1, 'analytics.reviewStatus': 1 });
TransactionLogSchema.index({ 'metadata.source': 1, timestamp: -1 });
TransactionLogSchema.index({ canisterTransactionId: 1, walletAddress: 1 }, { unique: true });

// Text index for search functionality
TransactionLogSchema.index({
  'metadata.description': 'text',
  'metadata.reference': 'text',
  errorMessage: 'text'
});

// Pre-save middleware
TransactionLogSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = new Date();
    this.version += 1;
  }
  
  // Auto-calculate analytics fields
  if (this.isNew || this.isModified('amount') || this.isModified('timestamp')) {
    this.calculateAnalytics();
  }
  
  next();
});

// Instance methods
TransactionLogSchema.methods.calculateAnalytics = function() {
  // Calculate transaction size category
  const amount = parseInt(this.amount);
  if (amount < 1000) {
    this.analytics.transactionSize = 'micro';
  } else if (amount < 10000) {
    this.analytics.transactionSize = 'small';
  } else if (amount < 100000) {
    this.analytics.transactionSize = 'medium';
  } else if (amount < 1000000) {
    this.analytics.transactionSize = 'large';
  } else {
    this.analytics.transactionSize = 'xlarge';
  }
  
  // Calculate time of day
  const hour = this.timestamp.getHours();
  if (hour >= 6 && hour < 12) {
    this.analytics.timeOfDay = 'morning';
  } else if (hour >= 12 && hour < 18) {
    this.analytics.timeOfDay = 'afternoon';
  } else if (hour >= 18 && hour < 22) {
    this.analytics.timeOfDay = 'evening';
  } else {
    this.analytics.timeOfDay = 'night';
  }
  
  // Calculate day of week
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  this.analytics.dayOfWeek = days[this.timestamp.getDay()] as any;
  
  // Basic risk scoring (can be enhanced with ML models)
  let riskScore = 0;
  if (this.analytics.transactionSize === 'xlarge') riskScore += 30;
  if (this.analytics.transactionSize === 'large') riskScore += 20;
  if (this.analytics.timeOfDay === 'night') riskScore += 10;
  if (this.retryCount > 2) riskScore += 15;
  
  this.analytics.riskScore = Math.min(riskScore, 100);
  this.analytics.flagged = riskScore > 50;
};

TransactionLogSchema.methods.markCompleted = function() {
  this.status = 'completed';
  this.analytics.reviewStatus = 'approved';
  return this.save();
};

TransactionLogSchema.methods.markFailed = function(errorCode: string, errorMessage: string) {
  this.status = 'failed';
  this.errorCode = errorCode;
  this.errorMessage = errorMessage.substring(0, 500);
  return this.save();
};

// Static methods
TransactionLogSchema.statics.findByWallet = function(walletAddress: string, limit: number = 50) {
  return this.find({ walletAddress })
    .sort({ timestamp: -1 })
    .limit(limit);
};

TransactionLogSchema.statics.findPendingTransactions = function() {
  return this.find({ status: 'pending' })
    .sort({ timestamp: 1 });
};

TransactionLogSchema.statics.getTransactionAnalytics = function(dateRange?: { start: Date; end: Date }) {
  const matchStage: any = {};
  if (dateRange) {
    matchStage.timestamp = { $gte: dateRange.start, $lte: dateRange.end };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          type: '$transactionType',
          tokenType: '$tokenType',
          status: '$status'
        },
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: '$amount' } },
        averageAmount: { $avg: { $toDouble: '$amount' } },
        flaggedCount: { $sum: { $cond: ['$analytics.flagged', 1, 0] } }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

TransactionLogSchema.statics.getFlaggedTransactions = function() {
  return this.find({
    'analytics.flagged': true,
    'analytics.reviewStatus': { $ne: 'approved' }
  }).sort({ 'analytics.riskScore': -1, timestamp: -1 });
};

// Export the model
export const TransactionLog = mongoose.model<ITransactionLog>('TransactionLog', TransactionLogSchema);

// Type exports
export type TransactionLogDocument = ITransactionLog;
export type TransactionLogModel = typeof TransactionLog;

/**
 * Usage Notes:
 * 
 * 1. This model is OPTIONAL - use only for analytics and audit trails
 * 2. The canister transaction history is the authoritative source
 * 3. Store only metadata and analytics data, never sensitive information
 * 4. Regularly sync with canister data to ensure consistency
 * 5. Use for reporting, compliance, and fraud detection
 * 6. Implement data retention policies (e.g., keep 7 years for compliance)
 * 7. Consider data anonymization for long-term storage
 * 8. Use indexes efficiently for large-scale analytics queries
 */