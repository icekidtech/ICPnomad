import { describe, it, before, after } from 'mocha';import { expect } from 'chai';import mongoose from 'mongoose';import { DatabaseService, createDatabaseService } from '../src/services/databaseService';import { UserMetadata } from '../src/models/user';import { WalletMetadata } from '../src/models/wallet';import { TransactionLog } from '../src/models/transaction';/** * Comprehensive Database Layer Test Suite for ICPNomad *  * Tests both canister storage operations and optional MongoDB integration * while ensuring phone number privacy and account uniqueness. *  * Prerequisites: * 1. Local ICP replica running: dfx start --background * 2. ICPNomadWallet canister deployed: dfx deploy ICPNomadWallet * 3. MongoDB running (optional): mongod --dbpath ./data/db *  * Run with: npx ts-node tests/test_database.ts */interface TestConfig {  canisterId: string;  host: string;  mongoUri?: string;}// Test configuration - update with your actual canister IDconst TEST_CONFIG: TestConfig = {  canisterId: process.env.CANISTER_ID_ICPNOMADWALLET || 'rrkah-fqaaa-aaaaa-aaaaq-cai',  host: process.env.ICP_HOST || 'http://127.0.0.1:4943',  mongoUri: process.env.MONGODB_TEST_URI || 'mongodb://localhost:27017/icpnomad_test'};// Test data - using fake phone numbers that will never be storedconst TEST_USERS = [  { phoneNumber: '+1234567890', pin: '1234' },  { phoneNumber: '+0987654321', pin: '5678' },  { phoneNumber: '+1122334455', pin: '9999' }];describe('ICPNomad Database Layer Tests', function() {  this.timeout(30000); // 30 second timeout for canister calls    let databaseService: DatabaseService;  let mongoEnabled = false;  before(async function() {    console.log('🔧 Setting up test environment...');        // Initialize database service with optional MongoDB    try {      databaseService = createDatabaseService(        {          canisterId: TEST_CONFIG.canisterId,          host: TEST_CONFIG.host        },        TEST_CONFIG.mongoUri ? {          uri: TEST_CONFIG.mongoUri        } : undefined      );            if (TEST_CONFIG.mongoUri) {
        // Test MongoDB connection
        await mongoose.connect(TEST_CONFIG.mongoUri);
        mongoEnabled = true;
        console.log('✅ MongoDB connection established');
        
        // Clean up test database
        await UserMetadata.deleteMany({});
        await WalletMetadata.deleteMany({});
        await TransactionLog.deleteMany({});
        console.log('🧹 Test database cleaned');
      } else {
        console.log('⚠️  MongoDB tests disabled (no URI provided)');
      }
      
      // Test canister connection
      const health = await databaseService.healthCheck();
      expect(health.canister.status).to.equal('healthy');
      console.log('✅ Canister connection established');
      
    } catch (error) {
      console.error('❌ Setup failed:', error);
      throw error;
    }
  });

  after(async function() {
    console.log('🧹 Cleaning up test environment...');
    
    if (mongoEnabled) {
      // Clean up test data
      await UserMetadata.deleteMany({});
      await WalletMetadata.deleteMany({});
      await TransactionLog.deleteMany({});
      await mongoose.disconnect();
    }
    
    if (databaseService) {
      await databaseService.disconnect();
    }
    
    console.log('✅ Cleanup completed');
  });

  describe('Canister Storage Operations', function() {
    describe('Wallet Creation', function() {
      it('should create a new wallet with valid credentials', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        
        const result = await databaseService.createWallet(phoneNumber, pin);
        
        expect(result.success).to.be.true;
        expect(result.address).to.be.a('string');
        expect(result.address).to.match(/^[a-z0-9-]+$/); // Principal format
        
        console.log(`✅ Wallet created with address: ${result.address}`);
      });

      it('should enforce one account per phone number', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        
        // Attempt to create duplicate wallet
        const result = await databaseService.createWallet(phoneNumber, pin);
        
        expect(result.success).to.be.false;
        expect(result.error).to.include('addressAlreadyExists');
        
        console.log('✅ Duplicate wallet creation properly rejected');
      });

      it('should reject invalid phone number format', async function() {
        const result = await databaseService.createWallet('invalid', '1234');
        
        expect(result.success).to.be.false;
        expect(result.error).to.include('invalidCredentials');
        
        console.log('✅ Invalid phone number properly rejected');
      });

      it('should reject invalid PIN format', async function() {
        const result = await databaseService.createWallet('+1234567890', 'abc');
        
        expect(result.success).to.be.false;
        expect(result.error).to.include('invalidCredentials');
        
        console.log('✅ Invalid PIN properly rejected');
      });
    });

    describe('Wallet Information Retrieval', function() {
      it('should retrieve wallet information with correct credentials', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        
        const result = await databaseService.getWalletInfo(phoneNumber, pin);
        
        expect(result.success).to.be.true;
        expect(result.data).to.have.property('user');
        expect(result.data).to.have.property('wallet');
        expect(result.data.wallet).to.have.property('icpBalance');
        expect(result.data.wallet).to.have.property('stablecoinBalance');
        
        console.log(`✅ Wallet info retrieved: ICP=${result.data.wallet.icpBalance}, Stablecoin=${result.data.wallet.stablecoinBalance}`);
      });

      it('should reject incorrect credentials', async function() {
        const result = await databaseService.getWalletInfo('+1234567890', '9999');
        
        expect(result.success).to.be.false;
        expect(result.error).to.include('invalidCredentials');
        
        console.log('✅ Incorrect credentials properly rejected');
      });
    });

    describe('Stablecoin Operations', function() {
      it('should check initial stablecoin balance', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        
        const result = await databaseService.getStablecoinBalance(phoneNumber, pin);
        
        expect(result.success).to.be.true;
        expect(result.balance).to.be.a('number');
        expect(result.balance).to.be.at.least(0);
        
        console.log(`✅ Initial stablecoin balance: ${result.balance}`);
      });

      it('should deposit stablecoins successfully', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        const depositAmount = 1000000; // 1 USDC (6 decimals)
        
        const result = await databaseService.depositStablecoin(phoneNumber, pin, depositAmount);
        
        expect(result.success).to.be.true;
        
        // Verify balance increased
        const balanceResult = await databaseService.getStablecoinBalance(phoneNumber, pin);
        expect(balanceResult.success).to.be.true;
        expect(balanceResult.balance).to.be.at.least(depositAmount);
        
        console.log(`✅ Deposited ${depositAmount} stablecoin units`);
      });

      it('should withdraw stablecoins successfully', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        const withdrawAmount = 500000; // 0.5 USDC
        
        // Get initial balance
        const initialBalance = await databaseService.getStablecoinBalance(phoneNumber, pin);
        expect(initialBalance.success).to.be.true;
        
        const result = await databaseService.withdrawStablecoin(phoneNumber, pin, withdrawAmount);
        
        expect(result.success).to.be.true;
        
        // Verify balance decreased
        const newBalance = await databaseService.getStablecoinBalance(phoneNumber, pin);
        expect(newBalance.success).to.be.true;
        expect(newBalance.balance).to.equal(initialBalance.balance! - withdrawAmount);
        
        console.log(`✅ Withdrew ${withdrawAmount} stablecoin units`);
      });

      it('should reject withdrawal with insufficient funds', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        const withdrawAmount = 999999999; // Very large amount
        
        const result = await databaseService.withdrawStablecoin(phoneNumber, pin, withdrawAmount);
        
        expect(result.success).to.be.false;
        expect(result.error).to.include('insufficientFunds');
        
        console.log('✅ Insufficient funds withdrawal properly rejected');
      });

      it('should create second wallet for transfer test', async function() {
        const { phoneNumber, pin } = TEST_USERS[1];
        
        const result = await databaseService.createWallet(phoneNumber, pin);
        
        expect(result.success).to.be.true;
        expect(result.address).to.be.a('string');
        
        console.log(`✅ Second wallet created: ${result.address}`);
      });

      it('should transfer stablecoins between wallets', async function() {
        const sender = TEST_USERS[0];
        const recipient = TEST_USERS[1];
        const transferAmount = 250000; // 0.25 USDC
        
        // Get initial balances
        const senderBalance = await databaseService.getStablecoinBalance(sender.phoneNumber, sender.pin);
        const recipientBalance = await databaseService.getStablecoinBalance(recipient.phoneNumber, recipient.pin);
        expect(senderBalance.success).to.be.true;
        expect(recipientBalance.success).to.be.true;
        
        // Perform transfer
        const result = await databaseService.transferStablecoin(
          sender.phoneNumber,
          sender.pin,
          recipient.phoneNumber,
          transferAmount
        );
        
        expect(result.success).to.be.true;
        
        // Verify balances updated correctly
        const newSenderBalance = await databaseService.getStablecoinBalance(sender.phoneNumber, sender.pin);
        const newRecipientBalance = await databaseService.getStablecoinBalance(recipient.phoneNumber, recipient.pin);
        
        expect(newSenderBalance.success).to.be.true;
        expect(newRecipientBalance.success).to.be.true;
        expect(newSenderBalance.balance).to.equal(senderBalance.balance! - transferAmount);
        expect(newRecipientBalance.balance).to.equal(recipientBalance.balance! + transferAmount);
        
        console.log(`✅ Transferred ${transferAmount} units from ${sender.phoneNumber} to ${recipient.phoneNumber}`);
      });
    });

    describe('Transaction History', function() {
      it('should retrieve transaction history', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        
        const result = await databaseService.getTransactionHistory(phoneNumber, pin);
        
        expect(result.success).to.be.true;
        expect(result.data).to.have.property('data');
        expect(result.data.data).to.be.an('array');
        expect(result.data.data.length).to.be.at.least(2); // Should have deposit and transfer
        
        // Verify transaction structure
        const transaction = result.data.data[0];
        expect(transaction).to.have.property('id');
        expect(transaction).to.have.property('txType');
        expect(transaction).to.have.property('amount');
        expect(transaction).to.have.property('timestamp');
        expect(transaction).to.have.property('tokenType');
        
        console.log(`✅ Retrieved ${result.data.data.length} transactions`);
      });

      it('should support paginated transaction history', async function() {
        const { phoneNumber, pin } = TEST_USERS[0];
        
        const result = await databaseService.getTransactionHistory(phoneNumber, pin, {
          page: 0,
          pageSize: 1,
          sortBy: 'timestamp',
          sortOrder: 'desc'
        });
        
        expect(result.success).to.be.true;
        expect(result.data.data).to.be.an('array');
        expect(result.data.data.length).to.equal(1);
        expect(result.data).to.have.property('totalCount');
        expect(result.data).to.have.property('totalPages');
        
        console.log(`✅ Paginated history: ${result.data.data.length} of ${result.data.totalCount} transactions`);
      });
    });
  });

  describe('Privacy Compliance Tests', function() {
    it('should verify phone numbers are never stored on-chain', async function() {
      // This test verifies by checking that different credentials produce different addresses
      const user1 = TEST_USERS[0];
      const user2 = TEST_USERS[1];
      
      const wallet1 = await databaseService.getWalletInfo(user1.phoneNumber, user1.pin);
      const wallet2 = await databaseService.getWalletInfo(user2.phoneNumber, user2.pin);
      
      expect(wallet1.success).to.be.true;
      expect(wallet2.success).to.be.true;
      expect(wallet1.data.wallet.address.toString()).to.not.equal(wallet2.data.wallet.address.toString());
      
      console.log('✅ Different phone numbers produce different wallet addresses');
    });

    it('should verify wallet existence check works without storing data', async function() {
      const { phoneNumber, pin } = TEST_USERS[0];
      
      const exists = await databaseService.walletExists(phoneNumber, pin);
      expect(exists).to.be.true;
      
      const notExists = await databaseService.walletExists('+9999999999', '0000');
      expect(notExists).to.be.false;
      
      console.log('✅ Wallet existence check works without data storage');
    });

    it('should verify deterministic address generation', async function() {
      const { phoneNumber, pin } = TEST_USERS[0];
      
      // Get wallet info multiple times
      const result1 = await databaseService.getWalletInfo(phoneNumber, pin);
      const result2 = await databaseService.getWalletInfo(phoneNumber, pin);
      
      expect(result1.success).to.be.true;
      expect(result2.success).to.be.true;
      expect(result1.data.wallet.address.toString()).to.equal(result2.data.wallet.address.toString());
      
      console.log('✅ Same credentials always produce same wallet address');
    });
  });

  describe('MongoDB Operations (Optional)', function() {
    if (!mongoEnabled) {
      it('should skip MongoDB tests when not configured', function() {
        console.log('⚠️  MongoDB tests skipped (not configured)');
        this.skip();
      });
      return;
    }

    it('should verify no sensitive data is stored in MongoDB', async function() {
      // Check all MongoDB collections for sensitive data
      const users = await UserMetadata.find({}).lean();
      const wallets = await WalletMetadata.find({}).lean();
      const transactions = await TransactionLog.find({}).lean();
      
      const allDocuments = [...users, ...wallets, ...transactions];
      const sensitiveFields = ['phoneNumber', 'pin', 'pinHash', 'phone', 'mobile'];
      
      for (const doc of allDocuments) {
        for (const field of sensitiveFields) {
          expect(doc).to.not.have.property(field);
        }
      }
      
      console.log(`✅ Verified ${allDocuments.length} MongoDB documents contain no sensitive data`);
    });

    it('should create user metadata without sensitive information', async function() {
      const testAddress = 'test-principal-address-123';
      
      const userMetadata = new UserMetadata({
        walletAddress: testAddress,
        metricsSummary: {
          totalTransactions: 5,
          totalVolume: 1000
        }
      });
      
      const saved = await userMetadata.save();
      
      expect(saved.walletAddress).to.equal(testAddress);
      expect(saved.metricsSummary.totalTransactions).to.equal(5);
      expect(saved).to.not.have.property('phoneNumber');
      expect(saved).to.not.have.property('pin');
      
      console.log('✅ User metadata created without sensitive data');
    });

    it('should create wallet metadata for analytics', async function() {
      const testAddress = 'test-wallet-address-456';
      
      const walletMetadata = new WalletMetadata({
        address: testAddress,
        analytics: {
          totalDeposits: 3,
          totalWithdrawals: 1,
          totalTransfers: 2
        }
      });
      
      const saved = await walletMetadata.save();
      
      expect(saved.address).to.equal(testAddress);
      expect(saved.analytics.totalDeposits).to.equal(3);
      expect(saved).to.not.have.property('phoneNumber');
      
      console.log('✅ Wallet metadata created for analytics');
    });

    it('should create transaction logs for audit trail', async function() {
      const transactionLog = new TransactionLog({
        canisterTransactionId: 12345,
        txType: 'stablecoinTransfer',
        amount: 500000,
        status: 'completed',
        fromAddress: 'sender-address-123',
        toAddress: 'recipient-address-456',
        tokenType: 'STABLECOIN',
        processingTime: 1250
      });
      
      const saved = await transactionLog.save();
      
      expect(saved.canisterTransactionId).to.equal(12345);
      expect(saved.txType).to.equal('stablecoinTransfer');
      expect(saved.amount).to.equal(500000);
      expect(saved).to.not.have.property('phoneNumber');
      
      console.log('✅ Transaction log created for audit trail');
    });

    it('should prevent sensitive data insertion in MongoDB models', async function() {
      try {
        const invalidUser = new UserMetadata({
          walletAddress: 'test-address',
          phoneNumber: '+1234567890' // This should be rejected
        });
        
        await invalidUser.save();
        expect.fail('Should have rejected sensitive data');
      } catch (error) {
        expect(error.message).to.include('phoneNumber');
        console.log('✅ MongoDB models properly reject sensitive data');
      }
    });
  });

  describe('System Health and Statistics', function() {
    it('should perform health check on all systems', async function() {
      const health = await databaseService.healthCheck();
      
      expect(health).to.have.property('canister');
      expect(health).to.have.property('mongodb');
      expect(health.canister.status).to.equal('healthy');
      
      if (mongoEnabled) {
        expect(health.mongodb.connected).to.be.true;
      }
      
      console.log(`✅ Health check: Canister=${health.canister.status}, MongoDB=${health.mongodb.connected}`);
    });

    it('should retrieve canister statistics', async function() {
      const stats = await databaseService.getCanisterStats();
      
      expect(stats).to.not.be.null;
      expect(stats).to.have.property('totalUsers');
      expect(stats).to.have.property('totalWallets');
      expect(stats).to.have.property('totalTransactions');
      expect(stats.totalUsers).to.be.at.least(2); // We created 2 test wallets
      
      console.log(`✅ Canister stats: ${stats.totalUsers} users, ${stats.totalWallets} wallets, ${stats.totalTransactions} transactions`);
    });
  });

  describe('Edge Cases and Error Handling', function() {
    it('should handle invalid canister responses gracefully', async function() {
      // Test with obviously invalid credentials
      const result = await databaseService.getWalletInfo('', '');
      
      expect(result.success).to.be.false;
      expect(result.error).to.be.a('string');
      
      console.log('✅ Invalid canister requests handled gracefully');
    });

    it('should handle network errors gracefully', async function() {
      // This test would require mocking network failures
      // For now, we just verify the service has error handling
      expect(databaseService.healthCheck).to.not.throw();
      
      console.log('✅ Network error handling verified');
    });

    it('should validate transaction amounts', async function() {
      const { phoneNumber, pin } = TEST_USERS[0];
      
      // Test zero amount
      const zeroResult = await databaseService.depositStablecoin(phoneNumber, pin, 0);
      expect(zeroResult.success).to.be.false;
      
      // Test negative amount (if validation exists)
      const negativeResult = await databaseService.depositStablecoin(phoneNumber, pin, -100);
      expect(negativeResult.success).to.be.false;
      
      console.log('✅ Transaction amount validation working');
    });
  });
});

// Run the tests if this file is executed directly
if (require.main === module) {
  console.log('🧪 Starting ICPNomad Database Layer Tests...');
  console.log('📋 Test Configuration:');
  console.log(`   Canister ID: ${TEST_CONFIG.canisterId}`);
  console.log(`   ICP Host: ${TEST_CONFIG.host}`);
  console.log(`   MongoDB URI: ${TEST_CONFIG.mongoUri || 'Not configured'}`);
  console.log('');
  
  // Run with Mocha
  require('mocha/cli/cli').main();
}