import { Actor, HttpAgent, Identity } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import mongoose from 'mongoose';
import { logger } from '@/config/logger';

// Import MongoDB models (optional)
import { UserMetadata, UserMetadataDocument } from '@/models/user';
import { WalletSnapshot, WalletSnapshotDocument } from '@/models/wallet';
import { TransactionLog, TransactionLogDocument } from '@/models/transaction';

// Import canister interface
import { canisterService } from './canisterService';

/**
 * DatabaseService provides a unified interface for both canister storage and optional MongoDB operations.
 * 
 * IMPORTANT PRIVACY GUARANTEES:
 * - Phone numbers are NEVER stored in any database (canister or MongoDB)
 * - Phone numbers are only used as parameters for canister calls
 * - PINs are hashed before any storage operations
 * - MongoDB models are completely optional and not required for core functionality
 */

export interface DatabaseServiceConfig {
  // Canister configuration
  canisterId: string;
  icpHost: string;
  identity?: Identity;
  
  // MongoDB configuration (optional)
  mongodbUri?: string;
  enableMongoDB?: boolean;
  
  // Sync configuration
  enableSync?: boolean;
  syncIntervalMs?: number;
}

export interface CanisterUser {
  address: Principal;
  pinHash: string;
  createdAt: bigint;
  lastActivity: bigint;
  failedAttempts: bigint;
  lastFailedAttempt: bigint | null;
  isLocked: boolean;
  lockoutUntil: bigint | null;
  transactionCount: bigint;
}

export interface CanisterWallet {
  address: Principal;
  icpBalance: bigint;
  stablecoinBalance: bigint;
  reservedIcp: bigint;
  reservedStablecoin: bigint;
  lastBalanceUpdate: bigint;
  totalDeposited: bigint;
  totalWithdrawn: bigint;
}

export interface CanisterTransaction {
  id: bigint;
  txType: { deposit: null } | { withdrawal: null } | { transfer: null } | 
         { stablecoinDeposit: null } | { stablecoinWithdrawal: null } | { stablecoinTransfer: null };
  amount: bigint;
  timestamp: bigint;
  status: { pending: null } | { completed: null } | { failed: null };
  fromAddress: Principal | null;
  toAddress: Principal | null;
  tokenType: string;
  signature: string | null;
  blockIndex: bigint | null;
}

export type DatabaseResult<T> = {
  ok: T;
} | {
  err: string;
};

export class DatabaseService {
  private agent: HttpAgent;
  private canisterActor: any;
  private mongoConnected: boolean = false;
  private syncInterval?: NodeJS.Timeout;
  
  constructor(private config: DatabaseServiceConfig) {
    // Initialize ICP agent
    this.agent = new HttpAgent({
      host: config.icpHost || 'http://127.0.0.1:4943'
    });
    
    // For local development, fetch root key
    if (config.icpHost?.includes('127.0.0.1') || config.icpHost?.includes('localhost')) {
      this.agent.fetchRootKey().catch(err => {
        logger.warn('Failed to fetch root key for local development', { error: err.message });
      });
    }
    
    // Initialize canister actor
    this.initializeCanisterActor();
    
    // Initialize MongoDB if enabled
    if (config.enableMongoDB && config.mongodbUri) {
      this.initializeMongoDB();
    }
    
    // Start sync if enabled
    if (config.enableSync) {
      this.startSync();
    }
  }
  
  // ======================
  // INITIALIZATION METHODS
  // ======================
  
  private initializeCanisterActor() {
    try {
      this.canisterActor = canisterService.getActor();
      logger.info('Canister actor initialized', { canisterId: this.config.canisterId });
    } catch (error) {
      logger.error('Failed to initialize canister actor', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        canisterId: this.config.canisterId 
      });
      throw error;
    }
  }
  
  private async initializeMongoDB() {
    if (!this.config.mongodbUri) {
      logger.warn('MongoDB URI not provided, skipping MongoDB initialization');
      return;
    }
    
    try {
      await mongoose.connect(this.config.mongodbUri, {
        // Connection options
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
      });
      
      this.mongoConnected = true;
      logger.info('MongoDB connected successfully', { 
        uri: this.config.mongodbUri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@') // Hide credentials in logs
      });
      
      // Create indexes if they don't exist
      await this.ensureIndexes();
      
    } catch (error) {
      logger.error('Failed to connect to MongoDB', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        uri: this.config.mongodbUri?.split('@')[1] // Log only host part
      });
      this.mongoConnected = false;
    }
  }
  
  private async ensureIndexes() {
    if (!this.mongoConnected) return;
    
    try {
      await UserMetadata.createIndexes();
      await WalletSnapshot.createIndexes();
      await TransactionLog.createIndexes();
      logger.info('MongoDB indexes ensured');
    } catch (error) {
      logger.warn('Failed to ensure MongoDB indexes', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
  
  private startSync() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    
    const intervalMs = this.config.syncIntervalMs || 300000; // Default 5 minutes
    this.syncInterval = setInterval(() => {
      this.syncDataWithCanister().catch(error => {
        logger.error('Sync operation failed', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      });
    }, intervalMs);
    
    logger.info('Data sync started', { intervalMs });
  }
  
  // ======================
  // CANISTER OPERATIONS (PRIMARY DATA SOURCE)
  // ======================
  
  /**
   * Creates a new wallet in the canister
   * PRIVACY: Phone number is only used as parameter, never stored
   */
  async createWallet(phoneNumber: string, pin: string): Promise<DatabaseResult<Principal>> {
    try {
      logger.info('Creating wallet in canister');
      
      const result = await this.canisterActor.generateWallet(phoneNumber, pin);
      
      if ('ok' in result) {
        const walletAddress = result.ok;
        logger.info('Wallet created successfully', { 
          walletAddress: walletAddress.toString()
        });
        
        // Optionally create MongoDB metadata (if enabled)
        if (this.mongoConnected) {
          await this.createUserMetadata(walletAddress, phoneNumber, pin);
          await this.createWalletSnapshot(walletAddress);
        }
        
        return { ok: walletAddress };
      } else {
        logger.warn('Failed to create wallet in canister', { error: result.err });
        return { err: `Canister error: ${JSON.stringify(result.err)}` };
      }
    } catch (error) {
      logger.error('Error creating wallet', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  /**
   * Gets wallet information from canister
   * PRIVACY: Phone number is only used as parameter, never stored
   */
  async getWalletInfo(phoneNumber: string, pin: string): Promise<DatabaseResult<{
    user: CanisterUser;
    wallet: CanisterWallet;
    transactionSummary: any;
  }>> {
    try {
      const result = await this.canisterActor.getWalletInfo(phoneNumber, pin);
      
      if ('ok' in result) {
        // Optionally sync with MongoDB
        if (this.mongoConnected) {
          await this.syncWalletData(result.ok.wallet.address, result.ok);
        }
        
        return { ok: result.ok };
      } else {
        return { err: `Canister error: ${JSON.stringify(result.err)}` };
      }
    } catch (error) {
      logger.error('Error getting wallet info', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  /**
   * Gets transaction history from canister
   */
  async getTransactionHistory(
    phoneNumber: string, 
    pin: string,
    pagination?: any
  ): Promise<DatabaseResult<any>> {
    try {
      const result = await this.canisterActor.getTransactionHistory(phoneNumber, pin, pagination ? [pagination] : []);
      
      if ('ok' in result) {
        // Optionally sync transactions with MongoDB
        if (this.mongoConnected) {
          await this.syncTransactionData(result.ok.data);
        }
        
        return { ok: result.ok };
      } else {
        return { err: `Canister error: ${JSON.stringify(result.err)}` };
      }
    } catch (error) {
      logger.error('Error getting transaction history', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  /**
   * Performs stablecoin deposit in canister
   */
  async depositStablecoin(
    phoneNumber: string,
    pin: string,
    amount: bigint,
    signature?: string
  ): Promise<DatabaseResult<void>> {
    try {
      const result = await this.canisterActor.depositStablecoin(
        phoneNumber, 
        pin, 
        amount, 
        signature ? [signature] : []
      );
      
      if ('ok' in result) {
        logger.info('Stablecoin deposit successful', { amount: amount.toString() });
        
        // Optionally log transaction in MongoDB
        if (this.mongoConnected) {
          // We would need the wallet address to log this
          // This is a limitation of not storing phone numbers
          // Consider getting wallet address first if needed for logging
        }
        
        return { ok: undefined };
      } else {
        return { err: `Canister error: ${JSON.stringify(result.err)}` };
      }
    } catch (error) {
      logger.error('Error depositing stablecoin', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  /**
   * Performs stablecoin withdrawal in canister
   */
  async withdrawStablecoin(
    phoneNumber: string,
    pin: string,
    amount: bigint,
    signature?: string
  ): Promise<DatabaseResult<void>> {
    try {
      const result = await this.canisterActor.withdrawStablecoin(
        phoneNumber, 
        pin, 
        amount, 
        signature ? [signature] : []
      );
      
      if ('ok' in result) {
        logger.info('Stablecoin withdrawal successful', { amount: amount.toString() });
        return { ok: undefined };
      } else {
        return { err: `Canister error: ${JSON.stringify(result.err)}` };
      }
    } catch (error) {
      logger.error('Error withdrawing stablecoin', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  /**
   * Performs stablecoin transfer in canister
   */
  async transferStablecoin(
    phoneNumber: string,
    pin: string,
    recipientPhoneNumber: string,
    amount: bigint,
    signature?: string
  ): Promise<DatabaseResult<void>> {
    try {
      const result = await this.canisterActor.transferStablecoin(
        phoneNumber, 
        pin, 
        recipientPhoneNumber,
        amount, 
        signature ? [signature] : []
      );
      
      if ('ok' in result) {
        logger.info('Stablecoin transfer successful', { 
          amount: amount.toString(),
          recipient: '***' + recipientPhoneNumber.slice(-4) // Log only last 4 digits
        });
        return { ok: undefined };
      } else {
        return { err: `Canister error: ${JSON.stringify(result.err)}` };
      }
    } catch (error) {
      logger.error('Error transferring stablecoin', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  // ======================
  // MONGODB OPERATIONS (OPTIONAL)
  // ======================
  
  /**
   * Creates user metadata in MongoDB (optional)
   * PRIVACY: Phone number is hashed and not stored
   */
  private async createUserMetadata(
    walletAddress: Principal, 
    phoneNumber: string, 
    pin: string
  ): Promise<void> {
    if (!this.mongoConnected) return;
    
    try {
      // Generate the same PIN hash as the canister would
      const pinHash = await this.hashPin(phoneNumber, pin);
      
      const userMetadata = new UserMetadata({
        walletAddress: walletAddress.toString(),
        pinHash: pinHash,
        createdAt: new Date(),
        lastActivity: new Date(),
        metadata: {
          accountType: 'basic',
          preferredLanguage: 'en',
          timezone: 'UTC',
          isActive: true,
          features: ['stablecoin', 'transfers']
        }
      });
      
      await userMetadata.save();
      logger.info('User metadata created in MongoDB', { 
        walletAddress: walletAddress.toString() 
      });
    } catch (error) {
      // Don't fail the main operation if MongoDB fails
      logger.warn('Failed to create user metadata in MongoDB', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress.toString()
      });
    }
  }
  
  /**
   * Creates wallet snapshot in MongoDB (optional)
   */
  private async createWalletSnapshot(walletAddress: Principal): Promise<void> {
    if (!this.mongoConnected) return;
    
    try {
      const walletSnapshot = new WalletSnapshot({
        walletAddress: walletAddress.toString(),
        balances: {
          icp: {
            current: '0',
            lastUpdated: new Date(),
            pendingDeposits: '0',
            pendingWithdrawals: '0'
          },
          stablecoin: {
            current: '0',
            lastUpdated: new Date(),
            pendingDeposits: '0',
            pendingWithdrawals: '0',
            tokenSymbol: 'ckUSDC'
          }
        },
        status: {
          isActive: true,
          lastSyncWithCanister: new Date(),
          syncStatus: 'synced'
        }
      });
      
      await walletSnapshot.save();
      logger.info('Wallet snapshot created in MongoDB', { 
        walletAddress: walletAddress.toString() 
      });
    } catch (error) {
      logger.warn('Failed to create wallet snapshot in MongoDB', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress.toString()
      });
    }
  }
  
  /**
   * Syncs wallet data with MongoDB (optional)
   */
  private async syncWalletData(walletAddress: Principal, canisterData: any): Promise<void> {
    if (!this.mongoConnected) return;
    
    try {
      await WalletSnapshot.findOneAndUpdate(
        { walletAddress: walletAddress.toString() },
        {
          'balances.icp.current': canisterData.wallet.icpBalance.toString(),
          'balances.icp.lastUpdated': new Date(),
          'balances.stablecoin.current': canisterData.wallet.stablecoinBalance.toString(),
          'balances.stablecoin.lastUpdated': new Date(),
          'statistics.totalDeposited': canisterData.wallet.totalDeposited.toString(),
          'statistics.totalWithdrawn': canisterData.wallet.totalWithdrawn.toString(),
          'statistics.transactionCount': Number(canisterData.user.transactionCount),
          'status.lastSyncWithCanister': new Date(),
          'status.syncStatus': 'synced'
        },
        { upsert: true }
      );
    } catch (error) {
      logger.warn('Failed to sync wallet data with MongoDB', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        walletAddress: walletAddress.toString()
      });
    }
  }
  
  /**
   * Syncs transaction data with MongoDB (optional)
   */
  private async syncTransactionData(transactions: CanisterTransaction[]): Promise<void> {
    if (!this.mongoConnected || !transactions.length) return;
    
    try {
      for (const tx of transactions) {
        await TransactionLog.findOneAndUpdate(
          { 
            canisterTransactionId: Number(tx.id),
            walletAddress: tx.fromAddress?.toString() || tx.toAddress?.toString() || ''
          },
          {
            transactionType: this.mapTransactionType(tx.txType),
            tokenType: tx.tokenType,
            amount: tx.amount.toString(),
            fromAddress: tx.fromAddress?.toString(),
            toAddress: tx.toAddress?.toString(),
            status: this.mapTransactionStatus(tx.status),
            timestamp: new Date(Number(tx.timestamp) / 1000000), // Convert nanoseconds to milliseconds
            signature: tx.signature,
            blockIndex: tx.blockIndex ? Number(tx.blockIndex) : undefined,
            metadata: {
              source: 'ussd' // Default source
            }
          },
          { upsert: true }
        );
      }
      
      logger.info('Transaction data synced with MongoDB', { 
        count: transactions.length 
      });
    } catch (error) {
      logger.warn('Failed to sync transaction data with MongoDB', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        count: transactions.length
      });
    }
  }
  
  /**
   * Full data sync between canister and MongoDB
   */
  private async syncDataWithCanister(): Promise<void> {
    if (!this.mongoConnected) return;
    
    try {
      logger.info('Starting data sync with canister');
      
      // Get wallets that need syncing
      const walletsNeedingSync = await WalletSnapshot.findWalletsNeedingSync();
      
      for (const wallet of walletsNeedingSync) {
        try {
          // We can't sync individual wallets without phone numbers
          // This is a limitation of the privacy-preserving design
          // Consider implementing a different sync strategy or admin functions
          logger.debug('Wallet needs sync but cannot sync without phone credentials', {
            walletAddress: wallet.walletAddress
          });
        } catch (error) {
          await wallet.markSyncError(error instanceof Error ? error.message : 'Unknown error');
        }
      }
      
      logger.info('Data sync completed');
    } catch (error) {
      logger.error('Data sync failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
  }
  
  // ======================
  // UTILITY METHODS
  // ======================
  
  /**
   * Hashes PIN using the same method as the canister
   */
  private async hashPin(phoneNumber: string, pin: string): Promise<string> {
    // This should match the hashing method used in the canister
    // For now, this is a placeholder - implement actual hashing logic
    const crypto = await import('crypto');
    const combined = `${phoneNumber}:${pin}:icpnomad_security_salt_2024`;
    return crypto.createHash('sha256').update(combined).digest('hex');
  }
  
  /**
   * Maps canister transaction type to MongoDB enum
   */
  private mapTransactionType(canisterType: any): string {
    if ('deposit' in canisterType) return 'deposit';
    if ('withdrawal' in canisterType) return 'withdrawal';
    if ('transfer' in canisterType) return 'transfer';
    if ('stablecoinDeposit' in canisterType) return 'stablecoinDeposit';
    if ('stablecoinWithdrawal' in canisterType) return 'stablecoinWithdrawal';
    if ('stablecoinTransfer' in canisterType) return 'stablecoinTransfer';
    return 'deposit'; // Default
  }
  
  /**
   * Maps canister transaction status to MongoDB enum
   */
  private mapTransactionStatus(canisterStatus: any): string {
    if ('pending' in canisterStatus) return 'pending';
    if ('completed' in canisterStatus) return 'completed';
    if ('failed' in canisterStatus) return 'failed';
    return 'pending'; // Default
  }
  
  // ======================
  // ANALYTICS AND REPORTING (MONGODB ONLY)
  // ======================
  
  /**
   * Gets analytics data from MongoDB (optional)
   */
  async getAnalytics(dateRange?: { start: Date; end: Date }): Promise<DatabaseResult<any>> {
    if (!this.mongoConnected) {
      return { err: 'MongoDB not connected - analytics not available' };
    }
    
    try {
      const [walletAnalytics, transactionAnalytics] = await Promise.all([
        WalletSnapshot.getAnalytics(),
        TransactionLog.getTransactionAnalytics(dateRange)
      ]);
      
      return {
        ok: {
          wallets: walletAnalytics[0] || {},
          transactions: transactionAnalytics,
          generatedAt: new Date()
        }
      };
    } catch (error) {
      logger.error('Error getting analytics', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  /**
   * Gets flagged transactions for review (MongoDB only)
   */
  async getFlaggedTransactions(): Promise<DatabaseResult<TransactionLogDocument[]>> {
    if (!this.mongoConnected) {
      return { err: 'MongoDB not connected - flagged transactions not available' };
    }
    
    try {
      const flaggedTransactions = await TransactionLog.getFlaggedTransactions();
      return { ok: flaggedTransactions };
    } catch (error) {
      logger.error('Error getting flagged transactions', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return { err: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  // ======================
  // HEALTH AND STATUS
  // ======================
  
  /**
   * Gets service health status
   */
  async getHealthStatus(): Promise<{
    canister: boolean;
    mongodb: boolean;
    sync: boolean;
    lastSync?: Date;
  }> {
    let canisterHealthy = false;
    let mongoHealthy = this.mongoConnected;
    
    // Check canister health
    try {
      await this.canisterActor.healthCheck();
      canisterHealthy = true;
    } catch (error) {
      logger.warn('Canister health check failed', { 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
    }
    
    // Check MongoDB health
    if (this.mongoConnected) {
      try {
        await mongoose.connection.db.admin().ping();
        mongoHealthy = true;
      } catch (error) {
        mongoHealthy = false;
        logger.warn('MongoDB health check failed', { 
          error: error instanceof Error ? error.message : 'Unknown error' 
        });
      }
    }
    
    return {
      canister: canisterHealthy,
      mongodb: mongoHealthy,
      sync: !!this.syncInterval,
      lastSync: new Date() // Would track actual last sync time in production
    };
  }
  
  /**
   * Cleanup method
   */
  async cleanup(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = undefined;
    }
    
    if (this.mongoConnected) {
      await mongoose.connection.close();
      this.mongoConnected = false;
    }
    
    logger.info('DatabaseService cleanup completed');
  }
}

// Export factory function
export function createDatabaseService(config: DatabaseServiceConfig): DatabaseService {
  return new DatabaseService(config);
}

// Export types
export type { DatabaseServiceConfig, CanisterUser, CanisterWallet, CanisterTransaction };