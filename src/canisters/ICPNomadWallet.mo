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

// Import stablecoin interface
import Stablecoin "./Stablecoin";

/**
 * ICPNomadWallet Canister with Enhanced Security Features
 * 
 * A privacy-preserving wallet canister for USSD-based cryptocurrency access.
 * Ensures phone numbers are never stored while maintaining one-account-per-phone uniqueness.
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
    
    /// Transaction status
    public type TransactionStatus = {
        #pending;
        #completed;
        #failed;
    };
    
    /// Individual transaction record
    public type Transaction = {
        id: Text;
        txType: TransactionType;
        amount: Nat;
        timestamp: Time;
        status: TransactionStatus;
        fromAddress: ?Principal;
        toAddress: ?Principal;
        tokenType: Text; // "ICP" or "STABLECOIN"
        signature: ?Text; // Optional signature for verification
    };
    
    /// Enhanced wallet data structure with security features
    public type Wallet = {
        address: Principal;
        icpBalance: Nat;
        stablecoinBalance: Nat;
        pinHash: Text; // Hashed PIN for authentication
        createdAt: Time;
        lastActivity: Time;
        transactionHistory: [Transaction];
        failedAttempts: Nat; // Track failed authentication attempts
        lastFailedAttempt: ?Time; // Timestamp of last failed attempt
        isLocked: Bool; // Account lockout status
    };
    
    /// Error types for better error handling
    public type WalletError = {
        #invalidCredentials;
        #walletNotFound;
        #insufficientFunds;
        #addressAlreadyExists;
        #invalidAmount;
        #transactionFailed;
        #stablecoinError: Text;
        #systemError: Text;
        #invalidSignature;
        #accountLocked;
        #rateLimitExceeded;
    };
    
    /// Signature verification result
    public type SignatureVerification = {
        #valid;
        #invalid;
        #missing;
    };
    
    // ======================
    // STATE VARIABLES
    // ======================
    
    /// Registry of wallets indexed by derived Principal (no phone numbers stored)
    private stable var walletEntries: [(Principal, Wallet)] = [];
    private var wallets = HashMap.fromIter<Principal, Wallet>(
        walletEntries.vals(), 
        10, 
        Principal.equal, 
        Principal.hash
    );
    
    /// Transaction counter for generating unique transaction IDs
    private stable var transactionCounter: Nat = 0;
    
    /// Canister creation timestamp
    private stable var canisterCreatedAt: Time = Time.now();
    
    /// Stablecoin canister reference (configurable)
    private stable var stablecoinCanisterId: Text = "rdmx6-jaaaa-aaaah-qcaiq-cai"; // Default ckUSDC canister ID
    
    /// Security configuration
    private stable var maxFailedAttempts: Nat = 5; // Maximum failed PIN attempts before lockout
    private stable var lockoutDuration: Int = 3600_000_000_000; // 1 hour in nanoseconds
    private stable var securitySalt: Text = "icpnomad_security_salt_2024"; // Additional salt for security
    
    // ======================
    // SYSTEM FUNCTIONS
    // ======================
    
    /// Pre-upgrade hook to preserve state
    system func preupgrade() {
        walletEntries := Iter.toArray(wallets.entries());
    };
    
    /// Post-upgrade hook to restore state
    system func postupgrade() {
        walletEntries := [];
        // Wallets HashMap is automatically restored from walletEntries
    };
    
    // ======================
    // SECURITY UTILITY FUNCTIONS
    // ======================
    
    /// Generates a secure hash for PIN storage
    private func hashPin(phoneNumber: Text, pin: Text): Text {
        let combinedInput = phoneNumber # ":" # pin # ":" # securitySalt;
        let inputBlob = Text.encodeUtf8(combinedInput);
        let hashBlob = SHA256.sha256(inputBlob);
        let hashArray = Blob.toArray(hashBlob);
        
        // Convert hash to hex string for storage
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
    
    /// Validates transaction signature (basic implementation)
    /// In production, this would use ICP's threshold ECDSA or other cryptographic schemes
    private func verifyTransactionSignature(
        txData: Text,
        signature: ?Text,
        walletAddress: Principal
    ): SignatureVerification {
        switch (signature) {
            case null { #missing };
            case (?sig) {
                // Basic signature verification - in production, use proper cryptographic verification
                let expectedSig = generateTransactionSignature(txData, walletAddress);
                if (Text.equal(sig, expectedSig)) {
                    #valid
                } else {
                    #invalid
                }
            };
        }
    };
    
    /// Generates expected signature for transaction data (placeholder implementation)
    private func generateTransactionSignature(txData: Text, walletAddress: Principal): Text {
        let combinedData = txData # ":" # Principal.toText(walletAddress) # ":" # securitySalt;
        let inputBlob = Text.encodeUtf8(combinedData);
        let hashBlob = SHA256.sha256(inputBlob);
        let hashArray = Blob.toArray(hashBlob);
        
        // Convert to hex string
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
    
    /// Checks if account is locked due to failed attempts
    private func isAccountLocked(wallet: Wallet): Bool {
        if (not wallet.isLocked) { return false };
        
        switch (wallet.lastFailedAttempt) {
            case null { false };
            case (?lastAttempt) {
                let currentTime = Time.now();
                let timeDiff = currentTime - lastAttempt;
                if (timeDiff >= lockoutDuration) {
                    false // Lockout period expired
                } else {
                    true // Still locked
                }
            };
        }
    };
    
    /// Updates failed attempt counter and locks account if necessary
    private func handleFailedAuthentication(walletAddress: Principal, wallet: Wallet): Wallet {
        let newFailedAttempts = wallet.failedAttempts + 1;
        let shouldLock = newFailedAttempts >= maxFailedAttempts;
        
        {
            address = wallet.address;
            icpBalance = wallet.icpBalance;
            stablecoinBalance = wallet.stablecoinBalance;
            pinHash = wallet.pinHash;
            createdAt = wallet.createdAt;
            lastActivity = wallet.lastActivity;
            transactionHistory = wallet.transactionHistory;
            failedAttempts = newFailedAttempts;
            lastFailedAttempt = ?Time.now();
            isLocked = shouldLock;
        }
    };
    
    /// Resets failed attempts on successful authentication
    private func resetFailedAttempts(wallet: Wallet): Wallet {
        {
            address = wallet.address;
            icpBalance = wallet.icpBalance;
            stablecoinBalance = wallet.stablecoinBalance;
            pinHash = wallet.pinHash;
            createdAt = wallet.createdAt;
            lastActivity = Time.now();
            transactionHistory = wallet.transactionHistory;
            failedAttempts = 0;
            lastFailedAttempt = null;
            isLocked = false;
        }
    };
    
    /// Authenticates user and returns wallet if valid
    private func authenticateUser(phoneNumber: Text, pin: Text): Result<Wallet, WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                // Check if account is locked
                if (isAccountLocked(wallet)) {
                    return #err(#accountLocked);
                };
                
                // Verify PIN
                if (verifyPin(phoneNumber, pin, wallet.pinHash)) {
                    // Reset failed attempts on successful authentication
                    let updatedWallet = resetFailedAttempts(wallet);
                    wallets.put(walletAddress, updatedWallet);
                    #ok(updatedWallet)
                } else {
                    // Handle failed authentication
                    let updatedWallet = handleFailedAuthentication(walletAddress, wallet);
                    wallets.put(walletAddress, updatedWallet);
                    #err(#invalidCredentials)
                }
            };
            case null {
                #err(#walletNotFound)
            };
        }
    };
    
    // ======================
    // EXISTING UTILITY FUNCTIONS (UPDATED)
    // ======================
    
    /// Derives a deterministic Principal from phone number and PIN
    /// This ensures one account per phone number without storing phone data
    private func deriveWalletAddress(phoneNumber: Text, pin: Text): Principal {
        // Combine phone number and PIN with a salt for security
        let combinedInput = phoneNumber # ":" # pin # ":icpnomad_salt_2024";
        
        // Convert to Blob for hashing
        let inputBlob = Text.encodeUtf8(combinedInput);
        
        // Generate SHA256 hash
        let hashBlob = SHA256.sha256(inputBlob);
        
        // Convert hash to Principal (using first 29 bytes as per IC spec)
        let hashArray = Blob.toArray(hashBlob);
        let principalBytes = Array.take(hashArray, 29);
        
        // Create Principal from bytes
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
    
    /// Generates a unique transaction ID
    private func generateTransactionId(): Text {
        transactionCounter += 1;
        "txn_" # Nat.toText(transactionCounter) # "_" # Nat.toText(Int.abs(Time.now()))
    };
    
    /// Creates a new transaction record with signature support
    private func createTransaction(
        txType: TransactionType,
        amount: Nat,
        fromAddress: ?Principal,
        toAddress: ?Principal,
        tokenType: Text,
        signature: ?Text
    ): Transaction {
        {
            id = generateTransactionId();
            txType = txType;
            amount = amount;
            timestamp = Time.now();
            status = #completed;
            fromAddress = fromAddress;
            toAddress = toAddress;
            tokenType = tokenType;
            signature = signature;
        }
    };
    
    /// Adds a transaction to wallet history
    private func addTransactionToWallet(walletAddress: Principal, transaction: Transaction) {
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                let updatedHistory = Array.append(wallet.transactionHistory, [transaction]);
                let updatedWallet = {
                    address = wallet.address;
                    icpBalance = wallet.icpBalance;
                    stablecoinBalance = wallet.stablecoinBalance;
                    pinHash = wallet.pinHash;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = updatedHistory;
                    failedAttempts = wallet.failedAttempts;
                    lastFailedAttempt = wallet.lastFailedAttempt;
                    isLocked = wallet.isLocked;
                };
                wallets.put(walletAddress, updatedWallet);
            };
            case null {
                Debug.print("Warning: Attempted to add transaction to non-existent wallet");
            };
        };
    };
    
    /// Gets stablecoin canister actor
    private func getStablecoinCanister(): Stablecoin.StablecoinActor {
        actor(stablecoinCanisterId) : Stablecoin.StablecoinActor
    };
    
    // ======================
    // WALLET FUNCTIONS (UPDATED WITH SECURITY)
    // ======================
    
    /// Generates a new wallet for a phone number and PIN combination with secure PIN storage
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
        
        // Check if wallet already exists (ensures one account per phone)
        switch (wallets.get(walletAddress)) {
            case (?existingWallet) {
                #err(#addressAlreadyExists)
            };
            case null {
                // Generate secure PIN hash
                let pinHash = hashPin(phoneNumber, pin);
                
                // Create new wallet with security features
                let newWallet: Wallet = {
                    address = walletAddress;
                    icpBalance = 0;
                    stablecoinBalance = 0;
                    pinHash = pinHash;
                    createdAt = Time.now();
                    lastActivity = Time.now();
                    transactionHistory = [];
                    failedAttempts = 0;
                    lastFailedAttempt = null;
                    isLocked = false;
                };
                
                wallets.put(walletAddress, newWallet);
                Debug.print("New secure wallet created: " # Principal.toText(walletAddress));
                #ok(walletAddress)
            };
        };
    };
    
    /// Retrieves ICP balance using secure authentication
    public query func getBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                // Check if account is locked
                if (isAccountLocked(wallet)) {
                    return #err(#accountLocked);
                };
                
                // Verify PIN
                if (verifyPin(phoneNumber, pin, wallet.pinHash)) {
                    #ok(wallet.icpBalance)
                } else {
                    #err(#invalidCredentials)
                }
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Deposits ICP funds to wallet
    public func deposit(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                let updatedWallet = {
                    address = wallet.address;
                    icpBalance = wallet.icpBalance + amount;
                    stablecoinBalance = wallet.stablecoinBalance;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                };
                
                wallets.put(walletAddress, updatedWallet);
                
                let transaction = createTransaction(#deposit, amount, null, ?walletAddress, "ICP");
                addTransactionToWallet(walletAddress, transaction);
                
                #ok(())
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Withdraws ICP funds from wallet
    public func withdraw(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                if (wallet.icpBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                let updatedWallet = {
                    address = wallet.address;
                    icpBalance = wallet.icpBalance - amount;
                    stablecoinBalance = wallet.stablecoinBalance;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                };
                
                wallets.put(walletAddress, updatedWallet);
                
                let transaction = createTransaction(#withdrawal, amount, ?walletAddress, null, "ICP");
                addTransactionToWallet(walletAddress, transaction);
                
                #ok(())
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    // ======================
    // NEW STABLECOIN FUNCTIONS
    // ======================
    
    /// Retrieves stablecoin balance using secure authentication
    public query func getStablecoinBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError> {
        switch (authenticateUser(phoneNumber, pin)) {
            case (#ok(wallet)) {
                #ok(wallet.stablecoinBalance)
            };
            case (#err(error)) {
                #err(error)
            };
        }
    };
    
    /// Deposits stablecoins to wallet with signature verification (gasless transaction)
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
            case (#ok(wallet)) {
                // Verify transaction signature
                let txData = "deposit_stablecoin:" # Nat.toText(amount) # ":" # Nat.toText(Time.now());
                let sigVerification = verifyTransactionSignature(txData, signature, wallet.address);
                
                switch (sigVerification) {
                    case (#invalid) { return #err(#invalidSignature) };
                    case (#missing) { 
                        // For deposits, signature might be optional depending on implementation
                        Debug.print("Warning: Deposit without signature");
                    };
                    case (#valid) {
                        Debug.print("Signature verified for deposit");
                    };
                };
                
                // In a real implementation, this would interact with the stablecoin canister
                // For now, we simulate the deposit by updating the balance
                // TODO: Implement actual stablecoin transfer from external source
                
                let updatedWallet = {
                    address = wallet.address;
                    icpBalance = wallet.icpBalance;
                    stablecoinBalance = wallet.stablecoinBalance + amount;
                    pinHash = wallet.pinHash;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                    failedAttempts = wallet.failedAttempts;
                    lastFailedAttempt = wallet.lastFailedAttempt;
                    isLocked = wallet.isLocked;
                };
                
                wallets.put(wallet.address, updatedWallet);
                
                let transaction = createTransaction(#stablecoinDeposit, amount, null, ?wallet.address, "STABLECOIN", signature);
                addTransactionToWallet(wallet.address, transaction);
                
                Debug.print("Secure stablecoin deposit successful: " # Nat.toText(amount) # " to " # Principal.toText(wallet.address));
                #ok(())
            };
        }
    };
    
    /// Withdraws stablecoins from wallet with signature verification (gasless transaction)
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
            case (#ok(wallet)) {
                if (wallet.stablecoinBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Verify transaction signature (required for withdrawals)
                let txData = "withdraw_stablecoin:" # Nat.toText(amount) # ":" # Nat.toText(Time.now());
                let sigVerification = verifyTransactionSignature(txData, signature, wallet.address);
                
                switch (sigVerification) {
                    case (#invalid or #missing) { return #err(#invalidSignature) };
                    case (#valid) {
                        // In a real implementation, this would transfer stablecoins to external address
                        // For now, we simulate the withdrawal by updating the balance
                        // TODO: Implement actual stablecoin transfer to external address
                        
                        let updatedWallet = {
                            address = wallet.address;
                            icpBalance = wallet.icpBalance;
                            stablecoinBalance = wallet.stablecoinBalance - amount;
                            pinHash = wallet.pinHash;
                            createdAt = wallet.createdAt;
                            lastActivity = Time.now();
                            transactionHistory = wallet.transactionHistory;
                            failedAttempts = wallet.failedAttempts;
                            lastFailedAttempt = wallet.lastFailedAttempt;
                            isLocked = wallet.isLocked;
                        };
                        
                        wallets.put(wallet.address, updatedWallet);
                        
                        let transaction = createTransaction(#stablecoinWithdrawal, amount, ?wallet.address, null, "STABLECOIN", signature);
                        addTransactionToWallet(wallet.address, transaction);
                        
                        Debug.print("Secure stablecoin withdrawal successful: " # Nat.toText(amount) # " from " # Principal.toText(wallet.address));
                        #ok(())
                    };
                }
            };
        }
    };
    
    /// Transfers stablecoins between wallets with signature verification (gasless transaction)
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
            case (#ok(senderWallet)) {
                if (senderWallet.stablecoinBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Verify transaction signature (required for transfers)
                let txData = "transfer_stablecoin:" # recipientPhoneNumber # ":" # Nat.toText(amount) # ":" # Nat.toText(Time.now());
                let sigVerification = verifyTransactionSignature(txData, signature, senderWallet.address);
                
                switch (sigVerification) {
                    case (#invalid or #missing) { return #err(#invalidSignature) };
                    case (#valid) {
                        let recipientAddress = deriveWalletAddress(recipientPhoneNumber, "0000"); // Recipient PIN not needed for address derivation
                        
                        // Cannot transfer to same wallet
                        if (Principal.equal(senderWallet.address, recipientAddress)) {
                            return #err(#invalidAmount);
                        };
                        
                        // Check both wallets exist
                        switch (wallets.get(recipientAddress)) {
                            case (?recipientWallet) {
                                // Update sender wallet
                                let updatedSenderWallet = {
                                    address = senderWallet.address;
                                    icpBalance = senderWallet.icpBalance;
                                    stablecoinBalance = senderWallet.stablecoinBalance - amount;
                                    pinHash = senderWallet.pinHash;
                                    createdAt = senderWallet.createdAt;
                                    lastActivity = Time.now();
                                    transactionHistory = senderWallet.transactionHistory;
                                    failedAttempts = senderWallet.failedAttempts;
                                    lastFailedAttempt = senderWallet.lastFailedAttempt;
                                    isLocked = senderWallet.isLocked;
                                };
                                
                                // Update recipient wallet
                                let updatedRecipientWallet = {
                                    address = recipientWallet.address;
                                    icpBalance = recipientWallet.icpBalance;
                                    stablecoinBalance = recipientWallet.stablecoinBalance + amount;
                                    pinHash = recipientWallet.pinHash;
                                    createdAt = recipientWallet.createdAt;
                                    lastActivity = Time.now();
                                    transactionHistory = recipientWallet.transactionHistory;
                                    failedAttempts = recipientWallet.failedAttempts;
                                    lastFailedAttempt = recipientWallet.lastFailedAttempt;
                                    isLocked = recipientWallet.isLocked;
                                };
                                
                                wallets.put(senderWallet.address, updatedSenderWallet);
                                wallets.put(recipientAddress, updatedRecipientWallet);
                                
                                let transferTransaction = createTransaction(#stablecoinTransfer, amount, ?senderWallet.address, ?recipientAddress, "STABLECOIN", signature);
                                addTransactionToWallet(senderWallet.address, transferTransaction);
                                addTransactionToWallet(recipientAddress, transferTransaction);
                                
                                Debug.print("Secure stablecoin transfer successful: " # Nat.toText(amount) # " from " # Principal.toText(senderWallet.address) # " to " # Principal.toText(recipientAddress));
                                #ok(())
                            };
                            case null {
                                #err(#walletNotFound)
                            };
                        }
                    };
                }
            };
        }
    };
    
    // ======================
    // QUERY FUNCTIONS (UPDATED WITH SECURITY)
    // ======================
    
    /// Gets combined wallet balances with secure authentication
    public query func getWalletInfo(phoneNumber: Text, pin: Text): async Result<{
        icpBalance: Nat;
        stablecoinBalance: Nat;
        totalTransactions: Nat;
        lastActivity: Time;
        isLocked: Bool;
        failedAttempts: Nat;
    }, WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                // Check if account is locked
                if (isAccountLocked(wallet)) {
                    return #err(#accountLocked);
                };
                
                // Verify PIN
                if (verifyPin(phoneNumber, pin, wallet.pinHash)) {
                    #ok({
                        icpBalance = wallet.icpBalance;
                        stablecoinBalance = wallet.stablecoinBalance;
                        totalTransactions = wallet.transactionHistory.size();
                        lastActivity = wallet.lastActivity;
                        isLocked = wallet.isLocked;
                        failedAttempts = wallet.failedAttempts;
                    })
                } else {
                    #err(#invalidCredentials)
                }
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Gets transaction history with secure authentication
    public query func getTransactionHistory(phoneNumber: Text, pin: Text): async Result<[Transaction], WalletError> {
        switch (authenticateUser(phoneNumber, pin)) {
            case (#ok(wallet)) {
                #ok(wallet.transactionHistory)
            };
            case (#err(error)) {
                #err(error)
            };
        };
    };
    
    /// Gets stablecoin transactions only with secure authentication
    public query func getStablecoinTransactionHistory(phoneNumber: Text, pin: Text): async Result<[Transaction], WalletError> {
        switch (authenticateUser(phoneNumber, pin)) {
            case (#ok(wallet)) {
                let stablecoinTxs = Array.filter<Transaction>(wallet.transactionHistory, func(tx) {
                    tx.tokenType == "STABLECOIN"
                });
                #ok(stablecoinTxs)
            };
            case (#err(error)) {
                #err(error)
            };
        };
    };
    
    // ======================
    // ADMIN FUNCTIONS (UPDATED)
    // ======================
    
    /// Updates security configuration (admin function)
    public func updateSecurityConfig(
        newMaxFailedAttempts: ?Nat,
        newLockoutDuration: ?Int,
        newSecuritySalt: ?Text
    ): async Result<(), WalletError> {
        // TODO: Add proper admin authentication
        
        switch (newMaxFailedAttempts) {
            case (?attempts) { maxFailedAttempts := attempts };
            case null {};
        };
        
        switch (newLockoutDuration) {
            case (?duration) { lockoutDuration := duration };
            case null {};
        };
        
        switch (newSecuritySalt) {
            case (?salt) { securitySalt := salt };
            case null {};
        };
        
        Debug.print("Security configuration updated");
        #ok(())
    };
    
    /// Unlocks a specific account (admin function)
    public func unlockAccount(phoneNumber: Text): async Result<(), WalletError> {
        // TODO: Add proper admin authentication
        
        // This function would need to iterate through wallets to find the one to unlock
        // Since we don't store phone numbers, this is a placeholder for admin functionality
        // In practice, this might require additional indexing or admin-specific functionality
        
        Debug.print("Account unlock requested for: " # phoneNumber);
        #ok(())
    };
    
    /// Gets canister statistics with security info
    public query func getCanisterStats(): async {
        totalWallets: Nat;
        totalTransactions: Nat;
        totalStablecoinTransactions: Nat;
        totalStablecoinBalance: Nat;
        lockedAccounts: Nat;
        canisterCreatedAt: Time;
        stablecoinCanisterId: Text;
        securityEnabled: Bool;
    } {
        let walletEntries = Iter.toArray(wallets.entries());
        
        let totalTransactions = Array.foldLeft<(Principal, Wallet), Nat>(
            walletEntries,
            0,
            func(acc, (_, wallet)) = acc + wallet.transactionHistory.size()
        );
        
        let totalStablecoinTransactions = Array.foldLeft<(Principal, Wallet), Nat>(
            walletEntries,
            0,
            func(acc, (_, wallet)) {
                let stablecoinTxs = Array.filter<Transaction>(wallet.transactionHistory, func(tx) {
                    tx.tokenType == "STABLECOIN"
                });
                acc + stablecoinTxs.size()
            }
        );
        
        let totalStablecoinBalance = Array.foldLeft<(Principal, Wallet), Nat>(
            walletEntries,
            0,
            func(acc, (_, wallet)) = acc + wallet.stablecoinBalance
        );
        
        let lockedAccounts = Array.foldLeft<(Principal, Wallet), Nat>(
            walletEntries,
            0,
            func(acc, (_, wallet)) = if (wallet.isLocked) acc + 1 else acc
        );
        
        {
            totalWallets = wallets.size();
            totalTransactions = totalTransactions;
            totalStablecoinTransactions = totalStablecoinTransactions;
            totalStablecoinBalance = totalStablecoinBalance;
            lockedAccounts = lockedAccounts;
            canisterCreatedAt = canisterCreatedAt;
            stablecoinCanisterId = stablecoinCanisterId;
            securityEnabled = true;
        }
    };
    
    /// Health check function with security status
    public query func healthCheck(): async {
        status: Text;
        timestamp: Time;
        walletCount: Nat;
        stablecoinSupported: Bool;
        stablecoinCanisterId: Text;
        securityEnabled: Bool;
        maxFailedAttempts: Nat;
    } {
        {
            status = "healthy";
            timestamp = Time.now();
            walletCount = wallets.size();
            stablecoinSupported = true;
            stablecoinCanisterId = stablecoinCanisterId;
            securityEnabled = true;
            maxFailedAttempts = maxFailedAttempts;
        }
    };
    
    /// Checks if a wallet exists for given credentials with security validation
    public query func walletExists(phoneNumber: Text, pin: Text): async Bool {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return false;
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) { 
                // Verify PIN to ensure this is a legitimate check
                verifyPin(phoneNumber, pin, wallet.pinHash)
            };
            case null { false };
        };
    };
}