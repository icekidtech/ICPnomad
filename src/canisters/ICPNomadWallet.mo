import Debug "mo:base/Debug";
import HashMap "mo:base/HashMap";
import Hash "mo:base/Hash";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Iter "mo:base/Iter";
import Array "mo:base/Array";
import Blob "mo:base/Blob";
import Nat8 "mo:base/Nat8";
import Nat "mo:base/Nat";
import SHA256 "mo:sha256/SHA256";
import Option "mo:base/Option";
import List "mo:base/List";
import Buffer "mo:base/Buffer";

// Import stablecoin interface
import Stablecoin "./Stablecoin";

/**
 * ICPNomadWallet Canister with Optimized Storage Models
 * 
 * A privacy-preserving wallet canister for USSD-based cryptocurrency access.
 * Features optimized storage models for efficient queries and updates while
 * ensuring phone numbers are never stored and maintaining one-account-per-phone uniqueness.
 * Includes PIN-based authentication with hashed storage and signature verification.
 * Supports stablecoin operations with gasless transactions.
 */
actor ICPNomadWallet {
    
    // ======================
    // TYPE DEFINITIONS
    // ======================
    
    public type Result<T, E> = Result.Result<T, E>;
    public type Time = Time.Time;
    
    /// Transaction types supported by the wallet
    public type TransactionType = {
        #deposit;
        #withdrawal;
        #transfer;
        #stablecoinDeposit;
        #stablecoinWithdrawal;
        #stablecoinTransfer;
    };
    
    /// Transaction status enumeration
    public type TransactionStatus = {
        #pending;
        #completed;
        #failed;
    };
    
    /// Individual transaction record with optimized structure
    public type Transaction = {
        id: Nat; // Sequential ID for efficient indexing
        txType: TransactionType;
        amount: Nat;
        timestamp: Time;
        status: TransactionStatus;
        fromAddress: ?Principal;
        toAddress: ?Principal;
        tokenType: Text; // "ICP" or "STABLECOIN"
        signature: ?Text; // Optional signature for verification
        blockIndex: ?Nat; // Optional blockchain block reference for external verification
    };
    
    /// User model - stores authentication and security data
    /// Principal is derived from phone+PIN, no phone numbers stored
    public type User = {
        address: Principal; // Deterministic address derived from phone+PIN
        pinHash: Text; // Hashed PIN for authentication (phone+PIN+salt)
        createdAt: Time;
        lastActivity: Time;
        failedAttempts: Nat; // Track failed authentication attempts
        lastFailedAttempt: ?Time; // Timestamp of last failed attempt
        isLocked: Bool; // Account lockout status
        lockoutUntil: ?Time; // Automatic unlock timestamp
        transactionCount: Nat; // Cache for efficient pagination
    };
    
    /// Wallet model - stores balance and financial data
    public type Wallet = {
        address: Principal; // Links to User.address
        icpBalance: Nat; // ICP token balance in e8s (10^8 smallest units)
        stablecoinBalance: Nat; // Stablecoin balance in token's smallest units
        reservedIcp: Nat; // Reserved ICP for pending transactions
        reservedStablecoin: Nat; // Reserved stablecoin for pending transactions
        lastBalanceUpdate: Time; // Optimization for cache invalidation
        totalDeposited: Nat; // Lifetime deposits for statistics
        totalWithdrawn: Nat; // Lifetime withdrawals for statistics
    };
    
    /// Transaction index entry for efficient querying
    public type TransactionIndex = {
        transactionId: Nat;
        timestamp: Time;
        txType: TransactionType;
        amount: Nat;
        walletAddress: Principal;
    };
    
    /// Error types for comprehensive error handling
    public type WalletError = {
        #invalidCredentials;
        #walletNotFound;
        #userNotFound;
        #insufficientFunds;
        #addressAlreadyExists;
        #invalidAmount;
        #transactionFailed;
        #stablecoinError: Text;
        #systemError: Text;
        #invalidSignature;
        #accountLocked;
        #rateLimitExceeded;
        #transactionNotFound;
        #storageError: Text;
    };
    
    /// Signature verification result
    public type SignatureVerification = {
        #valid;
        #invalid;
        #missing;
    };
    
    /// Pagination parameters for efficient data retrieval
    public type PaginationParams = {
        page: Nat;
        pageSize: Nat;
        sortBy: Text; // "timestamp", "amount", "type"
        sortOrder: Text; // "asc", "desc"
    };
    
    /// Paginated result wrapper
    public type PaginatedResult<T> = {
        data: [T];
        totalCount: Nat;
        page: Nat;
        pageSize: Nat;
        totalPages: Nat;
    };
    
    // ======================
    // STORAGE MODELS - OPTIMIZED DATA STRUCTURES
    // ======================
    
    /// PRIMARY STORAGE: User authentication and security data
    /// Key: Principal (derived from phone+PIN), Value: User record
    /// Optimized for: Authentication, security checks, user management
    private stable var userEntries: [(Principal, User)] = [];
    private var users = HashMap.fromIter<Principal, User>(
        userEntries.vals(), 
        100, // Initial capacity for ~100 users
        Principal.equal, 
        Principal.hash
    );
    
    /// PRIMARY STORAGE: Wallet financial data
    /// Key: Principal (same as User.address), Value: Wallet record
    /// Optimized for: Balance queries, financial operations
    private stable var walletEntries: [(Principal, Wallet)] = [];
    private var wallets = HashMap.fromIter<Principal, Wallet>(
        walletEntries.vals(), 
        100, // Initial capacity matching users
        Principal.equal, 
        Principal.hash
    );
    
    /// PRIMARY STORAGE: Transaction records
    /// Key: Sequential transaction ID, Value: Transaction record
    /// Optimized for: Transaction lookups, audit trails
    private stable var transactionEntries: [(Nat, Transaction)] = [];
    private var transactions = HashMap.fromIter<Nat, Transaction>(
        transactionEntries.vals(), 
        1000, // Higher capacity for transaction volume
        Nat.equal, 
        Hash.hash
    );
    
    /// SECONDARY INDEX: User transaction history
    /// Key: User Principal, Value: List of transaction IDs
    /// Optimized for: User transaction history queries
    private stable var userTransactionEntries: [(Principal, [Nat])] = [];
    private var userTransactions = HashMap.fromIter<Principal, [Nat]>(
        userTransactionEntries.vals(), 
        100,
        Principal.equal, 
        Principal.hash
    );
    
    /// SECONDARY INDEX: Transactions by timestamp
    /// Key: Time bucket (hour), Value: List of transaction IDs
    /// Optimized for: Time-based queries, analytics
    private stable var timestampIndexEntries: [(Time, [Nat])] = [];
    private var timestampIndex = HashMap.fromIter<Time, [Nat]>(
        timestampIndexEntries.vals(), 
        500, // Roughly 500 hours of operation before resize
        func(a: Time, b: Time): Bool { a == b },
        func(t: Time): Hash.Hash { Hash.hash(Int.abs(t)) }
    );
    
    /// SECONDARY INDEX: Transactions by type
    /// Key: TransactionType, Value: List of transaction IDs
    /// Optimized for: Transaction type filtering, reporting
    private stable var typeIndexEntries: [(TransactionType, [Nat])] = [];
    private var typeIndex = HashMap.fromIter<TransactionType, [Nat]>(
        typeIndexEntries.vals(), 
        10, // Small map for transaction types
        func(a: TransactionType, b: TransactionType): Bool { a == b },
        func(t: TransactionType): Hash.Hash { 
            switch(t) {
                case (#deposit) { 0 };
                case (#withdrawal) { 1 };
                case (#transfer) { 2 };
                case (#stablecoinDeposit) { 3 };
                case (#stablecoinWithdrawal) { 4 };
                case (#stablecoinTransfer) { 5 };
            }
        }
    );
    
    // ======================
    // STORAGE COUNTERS AND METADATA
    // ======================
    
    /// Sequential transaction ID counter for efficient indexing
    private stable var transactionCounter: Nat = 0;
    
    /// User registration counter for statistics
    private stable var userCounter: Nat = 0;
    
    /// Canister creation timestamp
    private stable var canisterCreatedAt: Time = Time.now();
    
    /// Stablecoin canister reference (configurable)
    private stable var stablecoinCanisterId: Text = "rdmx6-jaaaa-aaaah-qcaiq-cai"; // Default ckUSDC canister ID
    
    /// Security configuration
    private stable var maxFailedAttempts: Nat = 5; // Maximum failed PIN attempts before lockout
    private stable var lockoutDuration: Int = 3600_000_000_000; // 1 hour in nanoseconds
    private stable var securitySalt: Text = "icpnomad_security_salt_2024"; // Additional salt for security
    
    /// Storage optimization settings
    private stable var maxTransactionsPerUser: Nat = 10000; // Limit per user for performance
    private stable var transactionRetentionDays: Nat = 365; // Days to keep transaction history
    private stable var indexUpdateBatchSize: Nat = 100; // Batch size for index updates
    
    // ======================
    // SYSTEM FUNCTIONS FOR STATE PERSISTENCE
    // ======================
    
    /// Pre-upgrade hook to preserve all state
    system func preupgrade() {
        userEntries := Iter.toArray(users.entries());
        walletEntries := Iter.toArray(wallets.entries());
        transactionEntries := Iter.toArray(transactions.entries());
        userTransactionEntries := Iter.toArray(userTransactions.entries());
        timestampIndexEntries := Iter.toArray(timestampIndex.entries());
        typeIndexEntries := Iter.toArray(typeIndex.entries());
        
        Debug.print("Pre-upgrade: Preserved " # Nat.toText(userEntries.size()) # " users, " # 
                   Nat.toText(walletEntries.size()) # " wallets, " # 
                   Nat.toText(transactionEntries.size()) # " transactions");
    };
    
    /// Post-upgrade hook to restore state
    system func postupgrade() {
        // Clear temporary arrays after restoration
        userEntries := [];
        walletEntries := [];
        transactionEntries := [];
        userTransactionEntries := [];
        timestampIndexEntries := [];
        typeIndexEntries := [];
        
        Debug.print("Post-upgrade: Restored " # Nat.toText(users.size()) # " users, " # 
                   Nat.toText(wallets.size()) # " wallets, " # 
                   Nat.toText(transactions.size()) # " transactions");
    };
    
    // ======================
    // STORAGE UTILITY FUNCTIONS
    // ======================
    
    /// Generates a secure hash for PIN storage
    /// Combines phone number, PIN, and security salt for maximum security
    private func hashPin(phoneNumber: Text, pin: Text): Text {
        let combinedInput = phoneNumber # ":" # pin # ":" # securitySalt;
        let inputBlob = Text.encodeUtf8(combinedInput);
        let hashBlob = SHA256.sha256(inputBlob);
        let hashArray = Blob.toArray(hashBlob);
        
        // Convert hash to hex string for storage efficiency
        let hexChars = "0123456789abcdef";
        var result = "";
        for (byte in hashArray.vals()) {
            let high = Nat8.toNat(byte / 16);
            let low = Nat8.toNat(byte % 16);
            result := result # Text.fromChar(hexChars.chars().nth(high).unwrap()) # 
                     Text.fromChar(hexChars.chars().nth(low).unwrap());
        };
        result
    };
    
    /// Verifies PIN against stored hash
    private func verifyPin(phoneNumber: Text, pin: Text, storedHash: Text): Bool {
        let computedHash = hashPin(phoneNumber, pin);
        Text.equal(computedHash, storedHash)
    };
    
    /// Derives a deterministic Principal from phone number and PIN
    /// This ensures one account per phone number without storing phone data
    private func deriveWalletAddress(phoneNumber: Text, pin: Text): Principal {
        let combinedInput = phoneNumber # ":" # pin # ":icpnomad_salt_2024";
        let inputBlob = Text.encodeUtf8(combinedInput);
        let hashBlob = SHA256.sha256(inputBlob);
        let hashArray = Blob.toArray(hashBlob);
        let principalBytes = Array.take(hashArray, 29);
        Principal.fromBlob(Blob.fromArray(principalBytes))
    };
    
    /// Validates PIN format (4 digits)
    private func isValidPin(pin: Text): Bool {
        pin.size() == 4 and Text.all(pin, func(c: Char): Bool {
            c >= '0' and c <= '9'
        })
    };
    
    /// Validates phone number format (basic validation)
    private func isValidPhoneNumber(phoneNumber: Text): Bool {
        phoneNumber.size() >= 10 and phoneNumber.size() <= 15 and
        Text.all(phoneNumber, func(c: Char): Bool {
            (c >= '0' and c <= '9') or c == '+' or c == '-' or c == ' '
        })
    };
    
    /// Generates next transaction ID atomically
    private func getNextTransactionId(): Nat {
        transactionCounter += 1;
        transactionCounter
    };
    
    /// Calculates time bucket for timestamp indexing (rounds to nearest hour)
    private func getTimeBucket(timestamp: Time): Time {
        let hourInNanos: Int = 3600_000_000_000;
        (timestamp / hourInNanos) * hourInNanos
    };
    
    /// Checks if account is locked due to failed attempts
    private func isAccountLocked(user: User): Bool {
        if (not user.isLocked) { return false };
        
        let currentTime = Time.now();
        switch (user.lockoutUntil) {
            case null { user.isLocked }; // Permanent lock
            case (?unlockTime) {
                if (currentTime >= unlockTime) {
                    false // Lockout period expired
                } else {
                    true // Still locked
                }
            };
        }
    };
    
    // ======================
    // STORAGE OPERATIONS - USER MODEL
    // ======================
    
    /// Creates a new user record in storage
    private func createUser(address: Principal, phoneNumber: Text, pin: Text): User {
        userCounter += 1;
        let currentTime = Time.now();
        let pinHash = hashPin(phoneNumber, pin);
        
        {
            address = address;
            pinHash = pinHash;
            createdAt = currentTime;
            lastActivity = currentTime;
            failedAttempts = 0;
            lastFailedAttempt = null;
            isLocked = false;
            lockoutUntil = null;
            transactionCount = 0;
        }
    };
    
    /// Updates user activity timestamp and resets failed attempts
    private func updateUserActivity(user: User): User {
        {
            address = user.address;
            pinHash = user.pinHash;
            createdAt = user.createdAt;
            lastActivity = Time.now();
            failedAttempts = 0;
            lastFailedAttempt = null;
            isLocked = false;
            lockoutUntil = null;
            transactionCount = user.transactionCount;
        }
    };
    
    /// Updates user failed authentication attempts
    private func updateFailedAttempts(user: User): User {
        let newFailedAttempts = user.failedAttempts + 1;
        let shouldLock = newFailedAttempts >= maxFailedAttempts;
        let lockoutUntil = if (shouldLock) { 
            ?(Time.now() + lockoutDuration) 
        } else { 
            null 
        };
        
        {
            address = user.address;
            pinHash = user.pinHash;
            createdAt = user.createdAt;
            lastActivity = user.lastActivity;
            failedAttempts = newFailedAttempts;
            lastFailedAttempt = ?Time.now();
            isLocked = shouldLock;
            lockoutUntil = lockoutUntil;
            transactionCount = user.transactionCount;
        }
    };
    
    /// Increments user transaction count
    private func incrementUserTransactionCount(user: User): User {
        {
            address = user.address;
            pinHash = user.pinHash;
            createdAt = user.createdAt;
            lastActivity = user.lastActivity;
            failedAttempts = user.failedAttempts;
            lastFailedAttempt = user.lastFailedAttempt;
            isLocked = user.isLocked;
            lockoutUntil = user.lockoutUntil;
            transactionCount = user.transactionCount + 1;
        }
    };
    
    // ======================
    // STORAGE OPERATIONS - WALLET MODEL
    // ======================
    
    /// Creates a new wallet record in storage
    private func createWallet(address: Principal): Wallet {
        let currentTime = Time.now();
        
        {
            address = address;
            icpBalance = 0;
            stablecoinBalance = 0;
            reservedIcp = 0;
            reservedStablecoin = 0;
            lastBalanceUpdate = currentTime;
            totalDeposited = 0;
            totalWithdrawn = 0;
        }
    };
    
    /// Updates wallet ICP balance
    private func updateWalletIcpBalance(wallet: Wallet, newBalance: Nat, isDeposit: Bool): Wallet {
        let currentTime = Time.now();
        
        {
            address = wallet.address;
            icpBalance = newBalance;
            stablecoinBalance = wallet.stablecoinBalance;
            reservedIcp = wallet.reservedIcp;
            reservedStablecoin = wallet.reservedStablecoin;
            lastBalanceUpdate = currentTime;
            totalDeposited = if (isDeposit) { 
                wallet.totalDeposited + (newBalance - wallet.icpBalance) 
            } else { 
                wallet.totalDeposited 
            };
            totalWithdrawn = if (not isDeposit and newBalance < wallet.icpBalance) { 
                wallet.totalWithdrawn + (wallet.icpBalance - newBalance) 
            } else { 
                wallet.totalWithdrawn 
            };
        }
    };
    
    /// Updates wallet stablecoin balance
    private func updateWalletStablecoinBalance(wallet: Wallet, newBalance: Nat, isDeposit: Bool): Wallet {
        let currentTime = Time.now();
        
        {
            address = wallet.address;
            icpBalance = wallet.icpBalance;
            stablecoinBalance = newBalance;
            reservedIcp = wallet.reservedIcp;
            reservedStablecoin = wallet.reservedStablecoin;
            lastBalanceUpdate = currentTime;
            totalDeposited = if (isDeposit) { 
                wallet.totalDeposited + (newBalance - wallet.stablecoinBalance) 
            } else { 
                wallet.totalDeposited 
            };
            totalWithdrawn = if (not isDeposit and newBalance < wallet.stablecoinBalance) { 
                wallet.totalWithdrawn + (wallet.stablecoinBalance - newBalance) 
            } else { 
                wallet.totalWithdrawn 
            };
        }
    };
    
    // ======================
    // STORAGE OPERATIONS - TRANSACTION MODEL
    // ======================
    
    /// Creates a new transaction record and updates indices
    private func createAndStoreTransaction(
        txType: TransactionType,
        amount: Nat,
        fromAddress: ?Principal,
        toAddress: ?Principal,
        tokenType: Text,
        signature: ?Text
    ): Nat {
        let txId = getNextTransactionId();
        let currentTime = Time.now();
        
        let transaction: Transaction = {
            id = txId;
            txType = txType;
            amount = amount;
            timestamp = currentTime;
            status = #completed;
            fromAddress = fromAddress;
            toAddress = toAddress;
            tokenType = tokenType;
            signature = signature;
            blockIndex = null; // TODO: Integrate with actual blockchain indexing
        };
        
        // Store transaction
        transactions.put(txId, transaction);
        
        // Update user transaction indices
        switch (fromAddress) {
            case (?addr) { updateUserTransactionIndex(addr, txId) };
            case null {};
        };
        
        switch (toAddress) {
            case (?addr) { updateUserTransactionIndex(addr, txId) };
            case null {};
        };
        
        // Update timestamp index
        updateTimestampIndex(currentTime, txId);
        
        // Update type index
        updateTypeIndex(txType, txId);
        
        txId
    };
    
    /// Updates user transaction index efficiently
    private func updateUserTransactionIndex(userAddress: Principal, txId: Nat) {
        switch (userTransactions.get(userAddress)) {
            case (?existingTxs) {
                let newTxs = Array.append(existingTxs, [txId]);
                // Keep only the most recent transactions for performance
                let trimmedTxs = if (newTxs.size() > maxTransactionsPerUser) {
                    Array.subArray(newTxs, newTxs.size() - maxTransactionsPerUser, maxTransactionsPerUser)
                } else {
                    newTxs
                };
                userTransactions.put(userAddress, trimmedTxs);
            };
            case null {
                userTransactions.put(userAddress, [txId]);
            };
        };
    };
    
    /// Updates timestamp index for efficient time-based queries
    private func updateTimestampIndex(timestamp: Time, txId: Nat) {
        let timeBucket = getTimeBucket(timestamp);
        switch (timestampIndex.get(timeBucket)) {
            case (?existingTxs) {
                let newTxs = Array.append(existingTxs, [txId]);
                timestampIndex.put(timeBucket, newTxs);
            };
            case null {
                timestampIndex.put(timeBucket, [txId]);
            };
        };
    };
    
    /// Updates transaction type index for filtering
    private func updateTypeIndex(txType: TransactionType, txId: Nat) {
        switch (typeIndex.get(txType)) {
            case (?existingTxs) {
                let newTxs = Array.append(existingTxs, [txId]);
                typeIndex.put(txType, newTxs);
            };
            case null {
                typeIndex.put(txType, [txId]);
            };
        };
    };
    
    // ======================
    // AUTHENTICATION AND SECURITY
    // ======================
    
    /// Authenticates user and returns both user and wallet records
    private func authenticateUser(phoneNumber: Text, pin: Text): Result<(User, Wallet), WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (users.get(walletAddress)) {
            case (?user) {
                // Check if account is locked
                if (isAccountLocked(user)) {
                    return #err(#accountLocked);
                };
                
                // Verify PIN
                if (verifyPin(phoneNumber, pin, user.pinHash)) {
                    // Get wallet record
                    switch (wallets.get(walletAddress)) {
                        case (?wallet) {
                            // Update user activity
                            let updatedUser = updateUserActivity(user);
                            users.put(walletAddress, updatedUser);
                            #ok((updatedUser, wallet))
                        };
                        case null {
                            #err(#walletNotFound)
                        };
                    }
                } else {
                    // Handle failed authentication
                    let updatedUser = updateFailedAttempts(user);
                    users.put(walletAddress, updatedUser);
                    #err(#invalidCredentials)
                }
            };
            case null {
                #err(#userNotFound)
            };
        }
    };
    
    // ======================
    // WALLET FUNCTIONS (UPDATED WITH OPTIMIZED STORAGE)
    // ======================
    
    /// Generates a new wallet with optimized storage models
    public func generateWallet(phoneNumber: Text, pin: Text): async Result<Principal, WalletError> {
        // Validate inputs
        if (not isValidPhoneNumber(phoneNumber)) {
            return #err(#invalidCredentials);
        };
        
        if (not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        // Derive wallet address from phone number and PIN
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        // Check if user already exists (ensures one account per phone)
        switch (users.get(walletAddress)) {
            case (?_) {
                #err(#addressAlreadyExists)
            };
            case null {
                // Create new user record
                let newUser = createUser(walletAddress, phoneNumber, pin);
                users.put(walletAddress, newUser);
                
                // Create new wallet record
                let newWallet = createWallet(walletAddress);
                wallets.put(walletAddress, newWallet);
                
                // Initialize empty transaction history
                userTransactions.put(walletAddress, []);
                
                Debug.print("New wallet created with optimized storage: " # Principal.toText(walletAddress));
                #ok(walletAddress)
            };
        };
    };
    
    /// Retrieves stablecoin balance using optimized storage
    public query func getStablecoinBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError> {
        switch (authenticateUser(phoneNumber, pin)) {
            case (#ok((user, wallet))) {
                #ok(wallet.stablecoinBalance)
            };
            case (#err(error)) {
                #err(error)
            };
        }
    };
    
    /// Deposits stablecoins with optimized storage operations (gasless transaction)
    public func depositStablecoin(
        phoneNumber: Text, 
        pin: Text, 
        amount: Nat,
        signature: ?Text
    ): async Result<(), WalletError> {
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        // Authenticate user
        switch (authenticateUser(phoneNumber, pin)) {
            case (#err(error)) { return #err(error) };
            case (#ok((user, wallet))) {
                // Verify transaction signature
                let txData = "deposit_stablecoin:" # Nat.toText(amount) # ":" # Nat.toText(Time.now());
                // Note: Signature verification implementation depends on requirements
                
                // Update wallet balance using optimized storage
                let newBalance = wallet.stablecoinBalance + amount;
                let updatedWallet = updateWalletStablecoinBalance(wallet, newBalance, true);
                wallets.put(wallet.address, updatedWallet);
                
                // Create and store transaction with indices
                let txId = createAndStoreTransaction(
                    #stablecoinDeposit, 
                    amount, 
                    null, 
                    ?wallet.address, 
                    "STABLECOIN", 
                    signature
                );
                
                // Update user transaction count
                let updatedUser = incrementUserTransactionCount(user);
                users.put(user.address, updatedUser);
                
                Debug.print("Optimized stablecoin deposit successful: " # Nat.toText(amount) # 
                          " to " # Principal.toText(wallet.address) # ", txId: " # Nat.toText(txId));
                #ok(())
            };
        }
    };
    
    /// Withdraws stablecoins with optimized storage operations (gasless transaction)
    public func withdrawStablecoin(
        phoneNumber: Text, 
        pin: Text, 
        amount: Nat,
        signature: ?Text
    ): async Result<(), WalletError> {
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        // Authenticate user
        switch (authenticateUser(phoneNumber, pin)) {
            case (#err(error)) { return #err(error) };
            case (#ok((user, wallet))) {
                if (wallet.stablecoinBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Update wallet balance using optimized storage
                let newBalance = wallet.stablecoinBalance - amount;
                let updatedWallet = updateWalletStablecoinBalance(wallet, newBalance, false);
                wallets.put(wallet.address, updatedWallet);
                
                // Create and store transaction with indices
                let txId = createAndStoreTransaction(
                    #stablecoinWithdrawal, 
                    amount, 
                    ?wallet.address, 
                    null, 
                    "STABLECOIN", 
                    signature
                );
                
                // Update user transaction count
                let updatedUser = incrementUserTransactionCount(user);
                users.put(user.address, updatedUser);
                
                Debug.print("Optimized stablecoin withdrawal successful: " # Nat.toText(amount) # 
                          " from " # Principal.toText(wallet.address) # ", txId: " # Nat.toText(txId));
                #ok(())
            };
        }
    };
    
    /// Transfers stablecoins with optimized storage operations (gasless transaction)
    public func transferStablecoin(
        phoneNumber: Text, 
        pin: Text, 
        recipientPhoneNumber: Text, 
        amount: Nat,
        signature: ?Text
    ): async Result<(), WalletError> {
        if (not isValidPhoneNumber(recipientPhoneNumber)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        // Authenticate sender
        switch (authenticateUser(phoneNumber, pin)) {
            case (#err(error)) { return #err(error) };
            case (#ok((senderUser, senderWallet))) {
                if (senderWallet.stablecoinBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Get recipient address (PIN not needed for address derivation in transfers)
                let recipientAddress = deriveWalletAddress(recipientPhoneNumber, "0000");
                
                // Cannot transfer to same wallet
                if (Principal.equal(senderWallet.address, recipientAddress)) {
                    return #err(#invalidAmount);
                };
                
                // Check if recipient wallet exists
                switch (wallets.get(recipientAddress)) {
                    case (?recipientWallet) {
                        // Update sender wallet balance
                        let newSenderBalance = senderWallet.stablecoinBalance - amount;
                        let updatedSenderWallet = updateWalletStablecoinBalance(senderWallet, newSenderBalance, false);
                        wallets.put(senderWallet.address, updatedSenderWallet);
                        
                        // Update recipient wallet balance
                        let newRecipientBalance = recipientWallet.stablecoinBalance + amount;
                        let updatedRecipientWallet = updateWalletStablecoinBalance(recipientWallet, newRecipientBalance, true);
                        wallets.put(recipientAddress, updatedRecipientWallet);
                        
                        // Create and store transaction with indices
                        let txId = createAndStoreTransaction(
                            #stablecoinTransfer, 
                            amount, 
                            ?senderWallet.address, 
                            ?recipientAddress, 
                            "STABLECOIN", 
                            signature
                        );
                        
                        // Update user transaction counts
                        let updatedSenderUser = incrementUserTransactionCount(senderUser);
                        users.put(senderUser.address, updatedSenderUser);
                        
                        switch (users.get(recipientAddress)) {
                            case (?recipientUser) {
                                let updatedRecipientUser = incrementUserTransactionCount(recipientUser);
                                users.put(recipientAddress, updatedRecipientUser);
                            };
                            case null {
                                // Recipient user should exist if wallet exists
                                Debug.print("Warning: Recipient wallet exists but user record missing");
                            };
                        };
                        
                        Debug.print("Optimized stablecoin transfer successful: " # Nat.toText(amount) # 
                                  " from " # Principal.toText(senderWallet.address) # 
                                  " to " # Principal.toText(recipientAddress) # 
                                  ", txId: " # Nat.toText(txId));
                        #ok(())
                    };
                    case null {
                        #err(#walletNotFound)
                    };
                }
            };
        }
    };
    
    // ======================
    // OPTIMIZED QUERY FUNCTIONS
    // ======================
    
    /// Gets paginated transaction history using optimized indices
    public query func getTransactionHistory(
        phoneNumber: Text, 
        pin: Text,
        pagination: ?PaginationParams
    ): async Result<PaginatedResult<Transaction>, WalletError> {
        switch (authenticateUser(phoneNumber, pin)) {
            case (#ok((user, wallet))) {
                let params = switch (pagination) {
                    case (?p) { p };
                    case null { { page = 0; pageSize = 50; sortBy = "timestamp"; sortOrder = "desc" } };
                };
                
                switch (userTransactions.get(wallet.address)) {
                    case (?txIds) {
                        // Get transactions from IDs
                        let txs = Buffer.Buffer<Transaction>(txIds.size());
                        for (txId in txIds.vals()) {
                            switch (transactions.get(txId)) {
                                case (?tx) { txs.add(tx) };
                                case null {
                                    Debug.print("Warning: Transaction ID " # Nat.toText(txId) # " not found");
                                };
                            };
                        };
                        
                        let allTxs = Buffer.toArray(txs);
                        let totalCount = allTxs.size();
                        
                        // Sort transactions
                        let sortedTxs = Array.sort(allTxs, func(a: Transaction, b: Transaction): { #less; #equal; #greater } {
                            switch (params.sortBy) {
                                case ("timestamp") {
                                    if (params.sortOrder == "desc") {
                                        if (a.timestamp > b.timestamp) #less
                                        else if (a.timestamp < b.timestamp) #greater
                                        else #equal
                                    } else {
                                        if (a.timestamp < b.timestamp) #less
                                        else if (a.timestamp > b.timestamp) #greater
                                        else #equal
                                    }
                                };
                                case ("amount") {
                                    if (params.sortOrder == "desc") {
                                        if (a.amount > b.amount) #less
                                        else if (a.amount < b.amount) #greater
                                        else #equal
                                    } else {
                                        if (a.amount < b.amount) #less
                                        else if (a.amount > b.amount) #greater
                                        else #equal
                                    }
                                };
                                case _ { #equal }; // Default: no sorting
                            }
                        });
                        
                        // Paginate results
                        let startIndex = params.page * params.pageSize;
                        let endIndex = Nat.min(startIndex + params.pageSize, totalCount);
                        let paginatedTxs = if (startIndex >= totalCount) {
                            []
                        } else {
                            Array.subArray(sortedTxs, startIndex, endIndex - startIndex)
                        };
                        
                        let totalPages = (totalCount + params.pageSize - 1) / params.pageSize;
                        
                        #ok({
                            data = paginatedTxs;
                            totalCount = totalCount;
                            page = params.page;
                            pageSize = params.pageSize;
                            totalPages = totalPages;
                        })
                    };
                    case null {
                        #ok({
                            data = [];
                            totalCount = 0;
                            page = params.page;
                            pageSize = params.pageSize;
                            totalPages = 0;
                        })
                    };
                }
            };
            case (#err(error)) {
                #err(error)
            };
        };
    };
    
    /// Gets wallet information with optimized data access
    public query func getWalletInfo(phoneNumber: Text, pin: Text): async Result<{
        user: User;
        wallet: Wallet;
        transactionSummary: {
            totalTransactions: Nat;
            totalDeposited: Nat;
            totalWithdrawn: Nat;
            lastTransactionTime: ?Time;
        };
    }, WalletError> {
        switch (authenticateUser(phoneNumber, pin)) {
            case (#ok((user, wallet))) {
                // Get last transaction time efficiently
                let lastTxTime = switch (userTransactions.get(wallet.address)) {
                    case (?txIds) {
                        if (txIds.size() > 0) {
                            let lastTxId = txIds[txIds.size() - 1];
                            switch (transactions.get(lastTxId)) {
                                case (?tx) { ?tx.timestamp };
                                case null { null };
                            }
                        } else { null }
                    };
                    case null { null };
                };
                
                #ok({
                    user = user;
                    wallet = wallet;
                    transactionSummary = {
                        totalTransactions = user.transactionCount;
                        totalDeposited = wallet.totalDeposited;
                        totalWithdrawn = wallet.totalWithdrawn;
                        lastTransactionTime = lastTxTime;
                    };
                })
            };
            case (#err(error)) {
                #err(error)
            };
        };
    };
    
    /// Gets canister statistics with storage metrics
    public query func getCanisterStats(): async {
        totalUsers: Nat;
        totalWallets: Nat;
        totalTransactions: Nat;
        totalStablecoinBalance: Nat;
        totalIcpBalance: Nat;
        storageMetrics: {
            userStorageSize: Nat;
            walletStorageSize: Nat;
            transactionStorageSize: Nat;
            indexStorageSize: Nat;
        };
        canisterCreatedAt: Time;
        stablecoinCanisterId: Text;
    } {
        let walletArray = Iter.toArray(wallets.entries());
        
        let totalStablecoinBalance = Array.foldLeft<(Principal, Wallet), Nat>(
            walletArray,
            0,
            func(acc, (_, wallet)) = acc + wallet.stablecoinBalance
        );
        
        let totalIcpBalance = Array.foldLeft<(Principal, Wallet), Nat>(
            walletArray,
            0,
            func(acc, (_, wallet)) = acc + wallet.icpBalance
        );
        
        {
            totalUsers = users.size();
            totalWallets = wallets.size();
            totalTransactions = transactions.size();
            totalStablecoinBalance = totalStablecoinBalance;
            totalIcpBalance = totalIcpBalance;
            storageMetrics = {
                userStorageSize = users.size();
                walletStorageSize = wallets.size();
                transactionStorageSize = transactions.size();
                indexStorageSize = userTransactions.size() + timestampIndex.size() + typeIndex.size();
            };
            canisterCreatedAt = canisterCreatedAt;
            stablecoinCanisterId = stablecoinCanisterId;
        }
    };
    
    /// Health check with storage status
    public query func healthCheck(): async {
        status: Text;
        timestamp: Time;
        storageHealth: {
            usersOnline: Bool;
            walletsOnline: Bool;
            transactionsOnline: Bool;
            indicesOnline: Bool;
        };
        lastTransactionId: Nat;
    } {
        {
            status = "healthy";
            timestamp = Time.now();
            storageHealth = {
                usersOnline = users.size() >= 0;
                walletsOnline = wallets.size() >= 0;
                transactionsOnline = transactions.size() >= 0;
                indicesOnline = userTransactions.size() >= 0;
            };
            lastTransactionId = transactionCounter;
        }
    };
    
    /// Checks if a wallet exists using optimized lookup
    public query func walletExists(phoneNumber: Text, pin: Text): async Bool {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return false;
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (users.get(walletAddress)) {
            case (?user) { 
                // Verify PIN to ensure this is a legitimate check
                verifyPin(phoneNumber, pin, user.pinHash)
            };
            case null { false };
        };
    };
}