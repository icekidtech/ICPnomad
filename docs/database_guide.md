# ICPNomad Data Layer Guide

## Overview

The ICPNomad data layer implements a hybrid storage architecture that prioritizes user privacy while providing efficient access to blockchain wallet functionality. This guide covers the canister storage models, optional MongoDB integration, and testing procedures for the complete data layer.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Canister Storage Models](#canister-storage-models)
3. [Optional MongoDB Models](#optional-mongodb-models)
4. [Database Service Integration](#database-service-integration)
5. [Privacy and Security](#privacy-and-security)
6. [Testing Guide](#testing-guide)
7. [Performance Optimization](#performance-optimization)
8. [Future Enhancements](#future-enhancements)

## Architecture Overview

### Hybrid Storage Design

The ICPNomad data layer uses a hybrid approach:

- **Primary Storage**: Internet Computer (ICP) canister storage for all critical data
- **Secondary Storage**: Optional MongoDB for non-sensitive metadata and analytics
- **Privacy Guarantee**: Phone numbers and PINs are never stored anywhere

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   USSD Client   │    │   Backend API    │    │  ICPNomadWallet │
│                 │───▶│                  │───▶│    Canister     │
│ (Feature Phone) │    │ (Node.js/Express)│    │   (Motoko)      │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                               │                          │
                               ▼                          │
                       ┌──────────────────┐              │
                       │     MongoDB      │              │
                       │   (Optional)     │              │
                       │   Metadata Only  │              │
                       └──────────────────┘              │
                                                          │
                       ┌─────────────────────────────────┘
                       ▼
                ┌──────────────────┐
                │   ICP Blockchain │
                │  (Immutable Log) │
                └──────────────────┘
```

### Data Flow

1. **Authentication**: Phone number + PIN → Deterministic Principal derivation
2. **Storage**: All critical data stored in ICP canister
3. **Analytics**: Optional metadata stored in MongoDB (no sensitive data)
4. **Retrieval**: Direct canister queries for real-time data

## Canister Storage Models

The ICPNomadWallet canister implements three primary storage models:

### User Model

```motoko
public type User = {
    address: Principal;        // Derived from phone+PIN (deterministic)
    pinHash: Text;            // SHA256(phone+PIN+salt)
    createdAt: Time;          // Account creation timestamp
    lastActivity: Time;       // Last successful authentication
    failedAttempts: Nat;      // Failed authentication counter
    lastFailedAttempt: ?Time; // Timestamp of last failed attempt
    isLocked: Bool;           // Account lockout status
    lockoutUntil: ?Time;      // Automatic unlock timestamp
    transactionCount: Nat;    // Total transactions (cached for performance)
};
```

**Storage Structure**: `HashMap<Principal, User>`

**Key Features**:
- **Privacy**: No phone numbers stored, only deterministic addresses
- **Security**: PIN stored as salted hash
- **Authentication**: Failed attempt tracking with automatic lockout
- **Performance**: Transaction count cached for pagination

### Wallet Model

```motoko
public type Wallet = {
    address: Principal;           // Links to User.address
    icpBalance: Nat;             // ICP balance in e8s (10^8 units)
    stablecoinBalance: Nat;      // Stablecoin balance in token units
    reservedIcp: Nat;            // Reserved for pending transactions
    reservedStablecoin: Nat;     // Reserved stablecoin amount
    lastBalanceUpdate: Time;     // Cache invalidation timestamp
    totalDeposited: Nat;         // Lifetime deposits (analytics)
    totalWithdrawn: Nat;         // Lifetime withdrawals (analytics)
};
```

**Storage Structure**: `HashMap<Principal, Wallet>`

**Key Features**:
- **Multi-token**: Supports both ICP and stablecoins
- **Consistency**: Reserved amounts prevent double-spending
- **Analytics**: Lifetime statistics for reporting
- **Caching**: Balance updates for performance optimization

### Transaction Model

```motoko
public type TransactionType = {
    #Transfer;
    #Deposit;
    #Withdrawal;
    #Stake;
    #Unstake;
};

public type TransactionStatus = {
    #Pending;
    #Confirmed;
    #Failed;
    #Cancelled;
};

public type Transaction = {
    id: Text;                    // Unique transaction identifier
    userAddress: Principal;      // Transaction initiator
    transactionType: TransactionType;
    fromAddress: ?Principal;     // Source address (optional for deposits)
    toAddress: ?Principal;       // Destination address (optional for withdrawals)
    amount: Nat;                 // Amount in smallest unit (e8s for ICP)
    tokenType: Text;             // "ICP" or stablecoin identifier
    fee: Nat;                    // Transaction fee
    status: TransactionStatus;
    blockHeight: ?Nat;           // Blockchain block height (when confirmed)
    createdAt: Time;             // Transaction creation timestamp
    confirmedAt: ?Time;          // Confirmation timestamp
    errorMessage: ?Text;         // Error details for failed transactions
    metadata: ?Text;             // Additional transaction data (JSON)
};
```

**Storage Structure**: `HashMap<Text, Transaction>`

**Key Features**:
- **Immutability**: Transaction records are append-only
- **Traceability**: Complete audit trail with timestamps
- **Error Handling**: Failed transaction details preserved
- **Metadata**: Extensible transaction data storage

## Optional MongoDB Models

### Analytics Collection

```javascript
const analyticsSchema = {
    _id: ObjectId,
    eventType: String,           // "registration", "transaction", "login"
    timestamp: Date,
    country: String,             // Derived from phone prefix (no phone stored)
    amount: Number,              // For transaction events (anonymized)
    tokenType: String,           // "ICP" or stablecoin
    success: Boolean,            // Event success status
    errorCode: String,           // Error classification (if applicable)
    metadata: Object             // Additional non-sensitive data
};
```

### Usage Metrics Collection

```javascript
const usageMetricsSchema = {
    _id: ObjectId,
    date: Date,                  // Daily aggregation
    totalUsers: Number,          // Active users count
    newRegistrations: Number,    // New accounts created
    totalTransactions: Number,   // Transaction volume
    totalVolume: Number,         // Total value transferred
    averageTransactionSize: Number,
    peakUsageHour: Number,       // Hour with highest activity
    countryBreakdown: Map,       // Usage by country (phone prefix based)
    errorRate: Number            // Failed transaction percentage
};
```

**Privacy Notes**:
- No personally identifiable information stored
- Phone numbers never saved to MongoDB
- Country derived from phone prefix only
- All amounts are anonymized aggregates

## Database Service Integration

### Service Layer Architecture

```typescript
interface DatabaseService {
    // Canister operations
    createUser(phone: string, pin: string): Promise<Principal>;
    authenticateUser(phone: string, pin: string): Promise<Principal>;
    getWallet(address: Principal): Promise<Wallet>;
    createTransaction(tx: Transaction): Promise<string>;
    
    // MongoDB operations (optional)
    logAnalytics(event: AnalyticsEvent): Promise<void>;
    getUsageMetrics(startDate: Date, endDate: Date): Promise<UsageMetrics[]>;
}
```

### Implementation Example

```typescript
export class HybridDatabaseService implements DatabaseService {
    private canisterActor: ActorSubclass<ICPNomadWallet>;
    private mongoClient?: MongoClient;
    
    constructor(canisterActor: ActorSubclass<ICPNomadWallet>, mongoUri?: string) {
        this.canisterActor = canisterActor;
        if (mongoUri) {
            this.mongoClient = new MongoClient(mongoUri);
        }
    }
    
    async createUser(phone: string, pin: string): Promise<Principal> {
        // Generate deterministic principal
        const principal = derivePrincipal(phone, pin);
        
        // Create user in canister
        const result = await this.canisterActor.createUser(principal, hashPin(phone, pin));
        
        // Log analytics (no sensitive data)
        if (this.mongoClient) {
            await this.logAnalytics({
                eventType: "registration",
                country: deriveCountryFromPhone(phone),
                timestamp: new Date(),
                success: result.success
            });
        }
        
        return principal;
    }
}
```

## Privacy and Security

### Data Protection Principles

1. **Zero-Knowledge Storage**: Phone numbers and PINs never stored
2. **Deterministic Addresses**: Consistent user identification without PII
3. **Salted Hashing**: PIN verification without plain-text storage
4. **Minimal MongoDB**: Only non-sensitive metadata when enabled

### Security Measures

```motoko
// Account lockout mechanism
public func checkAccountLockout(user: User): Bool {
    switch (user.lockoutUntil) {
        case (?lockTime) {
            if (Time.now() < lockTime) {
                return true; // Still locked
            } else {
                // Auto-unlock expired lockout
                return false;
            }
        };
        case null { false };
    }
}

// Failed attempt tracking
public func incrementFailedAttempt(userAddress: Principal): async () {
    switch (users.get(userAddress)) {
        case (?user) {
            let newAttempts = user.failedAttempts + 1;
            let lockout = if (newAttempts >= MAX_FAILED_ATTEMPTS) {
                ?(Time.now() + LOCKOUT_DURATION)
            } else { user.lockoutUntil };
            
            let updatedUser = {
                user with
                failedAttempts = newAttempts;
                lastFailedAttempt = ?Time.now();
                isLocked = newAttempts >= MAX_FAILED_ATTEMPTS;
                lockoutUntil = lockout;
            };
            users.put(userAddress, updatedUser);
        };
        case null { /* User not found */ };
    }
}
```

## Testing Guide

### Unit Tests for Canister Models

```motoko
// Test user creation and authentication
public func testUserCreation(): async Bool {
    let testPrincipal = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
    let testPinHash = "hashed_pin_value";
    
    let user: User = {
        address = testPrincipal;
        pinHash = testPinHash;
        createdAt = Time.now();
        lastActivity = Time.now();
        failedAttempts = 0;
        lastFailedAttempt = null;
        isLocked = false;
        lockoutUntil = null;
        transactionCount = 0;
    };
    
    users.put(testPrincipal, user);
    
    switch (users.get(testPrincipal)) {
        case (?retrievedUser) {
            retrievedUser.pinHash == testPinHash
        };
        case null { false };
    }
}
```

### Integration Tests

```typescript
describe('Database Service Integration', () => {
    let dbService: HybridDatabaseService;
    
    beforeEach(async () => {
        // Initialize test canister and MongoDB
        dbService = new HybridDatabaseService(
            testCanisterActor,
            process.env.TEST_MONGO_URI
        );
    });
    
    test('should create user and log analytics', async () => {
        const phone = "+1234567890";
        const pin = "1234";
        
        const principal = await dbService.createUser(phone, pin);
        
        expect(principal).toBeDefined();
        
        // Verify user exists in canister
        const user = await dbService.getUser(principal);
        expect(user).toBeDefined();
        
        // Verify analytics logged (if MongoDB enabled)
        if (process.env.TEST_MONGO_URI) {
            const analytics = await dbService.getAnalytics({
                eventType: "registration",
                startDate: new Date(Date.now() - 1000)
            });
            expect(analytics.length).toBeGreaterThan(0);
        }
    });
});
```

### Performance Tests

```typescript
describe('Performance Tests', () => {
    test('should handle concurrent user creation', async () => {
        const promises = Array.from({ length: 100 }, (_, i) => 
            dbService.createUser(`+1234567${i.toString().padStart(3, '0')}`, "1234")
        );
        
        const startTime = Date.now();
        await Promise.all(promises);
        const endTime = Date.now();
        
        expect(endTime - startTime).toBeLessThan(10000); // Under 10 seconds
    });
});
```

## Performance Optimization

### Canister Storage Optimization

1. **Pagination**: Implement cursor-based pagination for transaction lists
2. **Caching**: Cache frequently accessed balances
3. **Indexing**: Use efficient HashMap structures for O(1) lookups
4. **Cleanup**: Implement old transaction archival strategies

### MongoDB Optimization

```javascript
// Indexes for analytics queries
db.analytics.createIndex({ "eventType": 1, "timestamp": 1 });
db.analytics.createIndex({ "country": 1, "timestamp": 1 });
db.usageMetrics.createIndex({ "date": 1 });

// Aggregation pipeline for daily metrics
const dailyMetricsPipeline = [
    {
        $match: {
            timestamp: { $gte: startDate, $lte: endDate }
        }
    },
    {
        $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$timestamp" } },
            totalTransactions: { $sum: 1 },
            totalVolume: { $sum: "$amount" },
            uniqueCountries: { $addToSet: "$country" }
        }
    }
];
```

### Caching Strategy

```typescript
interface CacheService {
    getUserBalance(address: Principal): Promise<Wallet>;
    invalidateUserCache(address: Principal): void;
    getTransactionHistory(address: Principal, page: number): Promise<Transaction[]>;
}

class RedisCacheService implements CacheService {
    private redis: Redis;
    private readonly TTL = 300; // 5 minutes
    
    async getUserBalance(address: Principal): Promise<Wallet> {
        const cacheKey = `wallet:${address.toString()}`;
        const cached = await this.redis.get(cacheKey);
        
        if (cached) {
            return JSON.parse(cached);
        }
        
        // Fetch from canister and cache
        const wallet = await canisterActor.getWallet(address);
        await this.redis.setex(cacheKey, this.TTL, JSON.stringify(wallet));
        
        return wallet;
    }
}
```

## Future Enhancements

### Planned Features

1. **Multi-Canister Scaling**: Shard users across multiple canisters
2. **Advanced Analytics**: Machine learning for fraud detection
3. **Data Archival**: Long-term storage solutions for historical data
4. **Real-time Notifications**: WebSocket integration for live updates

### Scalability Considerations

```motoko
// Sharding strategy for multi-canister deployment
public func getShardCanister(userAddress: Principal): Principal {
    let addressBytes = Principal.toBlob(userAddress);
    let shardIndex = Nat8.toNat(addressBytes[0]) % TOTAL_SHARDS;
    SHARD_CANISTERS[shardIndex]
}
```

### Migration Strategies

```typescript
interface MigrationService {
    migrateUserData(fromCanister: Principal, toCanister: Principal): Promise<void>;
    validateDataIntegrity(): Promise<boolean>;
    rollbackMigration(migrationId: string): Promise<void>;
}
```

## Conclusion

The ICPNomad data layer provides a robust, privacy-focused storage solution that balances decentralization with performance. The hybrid architecture ensures that sensitive user data remains secure on the Internet Computer while enabling optional analytics through MongoDB for business intelligence.

Key benefits:
- **Privacy by Design**: No PII storage anywhere
- **Scalability**: Hybrid architecture supports growth
- **Security**: Multiple layers of protection
- **Performance**: Efficient data access patterns
- **Flexibility**: Optional components based on requirements

For implementation questions or issues, refer to the specific canister and service documentation in the respective module directories.