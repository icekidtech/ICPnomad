import mongoose, { Schema, Document } from 'mongoose';

/**
 * IMPORTANT: This MongoDB model is OPTIONAL and NOT required for core functionality.
 * The ICPNomadWallet canister is the authoritative source for all wallet data.
 * 
 * This model is used only for:
 * - Balance snapshots for analytics
 * - Performance optimization (caching)
 * - Historical data analysis
 * - Off-chain metadata
 * 
 * NEVER store sensitive data or use this as the primary data source.
 */

export interface IWalletSnapshot extends Document {
  walletAddress: string; // Principal address (matches canister)
  balances: {
    icp: {
      current: string; // Stored as string to avoid precision issues
      lastUpdated: Date;
      pendingDeposits: string;
      pendingWithdrawals: string;
    };
    stablecoin: {
      current: string; // Stored as string to avoid precision issues
      lastUpdated: Date;
      pendingDeposits: string;
      pendingWithdrawals: string;
      tokenSymbol: string; // e.g., 'ckUSDC', 'ckUSDT'
    };
  };
  statistics: {
    totalDeposited: string; // Lifetime totals
    totalWithdrawn: string;
    transactionCount: number;
    firstTransactionDate?: Date;
    lastTransactionDate?: Date;
    averageTransactionSize: string;
    largestTransaction: string;
  };
  status: {
    isActive: boolean;
    lastSyncWithCanister: Date; // When this snapshot was last synced
    syncStatus: 'synced' | 'pending' | 'error';
    lastError?: string;
  };
  metadata: {
    accountTier: 'basic' | 'premium' | 'business';
    features: string[]; // Enabled features
    limits: {
      dailyTransactionLimit?: string;
      monthlyTransactionLimit?: string;
      maxSingleTransaction?: string;
    };
    riskScore: number; // 0-100, for compliance monitoring
  };
  // Audit fields
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

const WalletSnapshotSchema = new Schema<IWalletSnapshot>({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    index: true,
    validate: {
      validator: function(v: string) {
        return /^[a-zA-Z0-9\-]+$/.test(v) && v.length >= 20;
      },
      message: 'Invalid wallet address format'
    }
  },
  balances: {
    icp: {
      current: {
        type: String,
        required: true,
        default: '0',
        validate: {
          validator: function(v: string) {
            return /^\d+$/.test(v); // Only positive integers as strings
          },
          message: 'Invalid ICP balance format'
        }
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
        index: true
      },
      pendingDeposits: {
        type: String,
        default: '0'
      },
      pendingWithdrawals: {
        type: String,
        default: '0'
      }
    },
    stablecoin: {
      current: {
        type: String,
        required: true,
        default: '0',
        validate: {
          validator: function(v: string) {
            return /^\d+$/.test(v);
          },
          message: 'Invalid stablecoin balance format'
        }
      },
      lastUpdated: {
        type: Date,
        default: Date.now,
        index: true
      },
      pendingDeposits: {
        type: String,
        default: '0'
      },
      pendingWithdrawals: {
        type: String,
        default: '0'
      },
      tokenSymbol: {
        type: String,
        default: 'ckUSDC',
        enum: ['ckUSDC', 'ckUSDT', 'ckBTC', 'ckETH', 'CUSTOM']
      }
    }
  },
  statistics: {
    totalDeposited: {
      type: String,
      default: '0'
    },
    totalWithdrawn: {
      type: String,
      default: '0'
    },
    transactionCount: {
      type: Number,
      default: 0,
      min: 0,
      index: true
    },
    firstTransactionDate: {
      type: Date,
      index: true
    },
    lastTransactionDate: {
      type: Date,
      index: true
    },
    averageTransactionSize: {
      type: String,
      default: '0'
    },
    largestTransaction: {
      type: String,
      default: '0'
    }
  },
  status: {
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    lastSyncWithCanister: {
      type: Date,
      default: Date.now,
      index: true
    },
    syncStatus: {
      type: String,
      enum: ['synced', 'pending', 'error'],
      default: 'synced',
      index: true
    },
    lastError: {
      type: String,
      maxlength: 500
    }
  },
  metadata: {
    accountTier: {
      type: String,
      enum: ['basic', 'premium', 'business'],
      default: 'basic',
      index: true
    },
    features: [{
      type: String,
      enum: ['stablecoin', 'transfers', 'batch_transfers', 'scheduled_payments', 'merchant_pay', 'savings', 'loans']
    }],
    limits: {
      dailyTransactionLimit: {
        type: String,
        validate: {
          validator: function(v: string | undefined) {
            return !v || /^\d+$/.test(v);
          },
          message: 'Invalid limit format'
        }
      },
      monthlyTransactionLimit: {
        type: String,
        validate: {
          validator: function(v: string | undefined) {
            return !v || /^\d+$/.test(v);
          },
          message: 'Invalid limit format'
        }
      },
      maxSingleTransaction: {
        type: String,
        validate: {
          validator: function(v: string | undefined) {
            return !v || /^\d+$/.test(v);
          },
          message: 'Invalid limit format'
        }
      }
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
      index: true
    }
  },
  createdAt: {
    type: Date,
    default: Date.now,
    immutable: true
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
  collection: 'wallet_snapshots'
});

// Compound indexes for common queries
WalletSnapshotSchema.index({ 
  'status.isActive': 1, 
  'status.lastSyncWithCanister': -1 
});
WalletSnapshotSchema.index({ 
  'metadata.accountTier': 1, 
  'statistics.transactionCount': -1 
});
WalletSnapshotSchema.index({ 
  'balances.icp.lastUpdated': -1,
  'balances.stablecoin.lastUpdated': -1 
});

// Pre-save middleware
WalletSnapshotSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = new Date();
    this.version += 1;
  }
  next();
});

// Static methods
WalletSnapshotSchema.statics.findActiveWallets = function() {
  return this.find({ 'status.isActive': true });
};

WalletSnapshotSchema.statics.findWalletsNeedingSync = function(maxAge: number = 300000) {
  const cutoff = new Date(Date.now() - maxAge); // Default 5 minutes
  return this.find({
    'status.isActive': true,
    'status.lastSyncWithCanister': { $lt: cutoff }
  });
};

WalletSnapshotSchema.statics.getAnalytics = function() {
  return this.aggregate([
    { $match: { 'status.isActive': true } },
    {
      $group: {
        _id: null,
        totalWallets: { $sum: 1 },
        totalIcpBalance: { $sum: { $toDouble: '$balances.icp.current' } },
        totalStablecoinBalance: { $sum: { $toDouble: '$balances.stablecoin.current' } },
        totalTransactions: { $sum: '$statistics.transactionCount' },
        averageBalance: { $avg: { $toDouble: '$balances.stablecoin.current' } }
      }
    }
  ]);
};

// Instance methods
WalletSnapshotSchema.methods.updateBalance = function(
  tokenType: 'icp' | 'stablecoin',
  newBalance: string
) {
  this.balances[tokenType].current = newBalance;
  this.balances[tokenType].lastUpdated = new Date();
  this.status.lastSyncWithCanister = new Date();
  this.status.syncStatus = 'synced';
  return this.save();
};

WalletSnapshotSchema.methods.recordTransaction = function(amount: string) {
  this.statistics.transactionCount += 1;
  this.statistics.lastTransactionDate = new Date();
  
  if (!this.statistics.firstTransactionDate) {
    this.statistics.firstTransactionDate = new Date();
  }
  
  // Update largest transaction
  const amountNum = parseFloat(amount);
  const largestNum = parseFloat(this.statistics.largestTransaction);
  if (amountNum > largestNum) {
    this.statistics.largestTransaction = amount;
  }
  
  // Update average transaction size
  const currentAvg = parseFloat(this.statistics.averageTransactionSize) || 0;
  const count = this.statistics.transactionCount;
  const newAvg = ((currentAvg * (count - 1)) + amountNum) / count;
  this.statistics.averageTransactionSize = newAvg.toString();
  
  return this.save();
};

WalletSnapshotSchema.methods.markSyncError = function(error: string) {
  this.status.syncStatus = 'error';
  this.status.lastError = error.substring(0, 500); // Limit error message length
  this.status.lastSyncWithCanister = new Date();
  return this.save();
};

// Export the model
export const WalletSnapshot = mongoose.model<IWalletSnapshot>('WalletSnapshot', WalletSnapshotSchema);

// Type exports
export type WalletSnapshotDocument = IWalletSnapshot;
export type WalletSnapshotModel = typeof WalletSnapshot;

/**
 * Usage Notes:
 * 
 * 1. This model is OPTIONAL - use only for analytics and caching
 * 2. The canister is always the authoritative source of truth
 * 3. Regularly sync snapshots with canister data
 * 4. Use string types for large numbers to avoid JavaScript precision issues
 * 5. Implement data retention policies for old snapshots
 * 6. Monitor sync status and handle sync errors appropriately
 * 7. Consider implementing real-time sync via canister callbacks (future enhancement)
 */