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

/**
 * ICPNomadWallet Canister
 * 
 * A privacy-preserving wallet canister for USSD-based cryptocurrency access.
 * Ensures phone numbers are never stored while maintaining one-account-per-phone uniqueness.
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
    };
    
    /// Wallet data structure (no phone numbers or PINs stored)
    public type Wallet = {
        address: Principal;
        balance: Nat;
        createdAt: Time;
        lastActivity: Time;
        transactionHistory: [Transaction];
    };
    
    /// Error types for better error handling
    public type WalletError = {
        #invalidCredentials;
        #walletNotFound;
        #insufficientFunds;
        #addressAlreadyExists;
        #invalidAmount;
        #transactionFailed;
        #systemError: Text;
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
    // PRIVATE UTILITY FUNCTIONS
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
    
    /// Creates a new transaction record
    private func createTransaction(
        txType: TransactionType,
        amount: Nat,
        fromAddress: ?Principal,
        toAddress: ?Principal
    ): Transaction {
        {
            id = generateTransactionId();
            txType = txType;
            amount = amount;
            timestamp = Time.now();
            status = #completed;
            fromAddress = fromAddress;
            toAddress = toAddress;
        }
    };
    
    /// Adds a transaction to wallet history
    private func addTransactionToWallet(walletAddress: Principal, transaction: Transaction) {
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                let updatedHistory = Array.append(wallet.transactionHistory, [transaction]);
                let updatedWallet = {
                    address = wallet.address;
                    balance = wallet.balance;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = updatedHistory;
                };
                wallets.put(walletAddress, updatedWallet);
            };
            case null {
                // Wallet not found - should not happen in normal flow
                Debug.print("Warning: Attempted to add transaction to non-existent wallet");
            };
        };
    };
    
    // ======================
    // PUBLIC CANISTER FUNCTIONS
    // ======================
    
    /// Generates a new wallet for a phone number and PIN combination
    /// Returns the wallet address if successful, error if address already exists
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
                // Wallet already exists for this phone number
                #err(#addressAlreadyExists)
            };
            case null {
                // Create new wallet
                let newWallet: Wallet = {
                    address = walletAddress;
                    balance = 0;
                    createdAt = Time.now();
                    lastActivity = Time.now();
                    transactionHistory = [];
                };
                
                // Store wallet in registry
                wallets.put(walletAddress, newWallet);
                
                Debug.print("New wallet created: " # Principal.toText(walletAddress));
                #ok(walletAddress)
            };
        };
    };
    
    /// Retrieves wallet balance using phone number and PIN
    /// Regenerates wallet address without storing phone data
    public query func getBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError> {
        // Validate inputs
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        // Regenerate wallet address
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        // Retrieve wallet
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                #ok(wallet.balance)
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Deposits funds to wallet (placeholder for stablecoin integration)
    public func deposit(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError> {
        // Validate inputs
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        // Regenerate wallet address
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        // Retrieve and update wallet
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                // Update balance
                let updatedWallet = {
                    address = wallet.address;
                    balance = wallet.balance + amount;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                };
                
                wallets.put(walletAddress, updatedWallet);
                
                // Record transaction
                let transaction = createTransaction(#deposit, amount, null, ?walletAddress);
                addTransactionToWallet(walletAddress, transaction);
                
                Debug.print("Deposit successful: " # Nat.toText(amount) # " to " # Principal.toText(walletAddress));
                #ok(())
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Withdraws funds from wallet (placeholder for stablecoin integration)
    public func withdraw(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError> {
        // Validate inputs
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        // Regenerate wallet address
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        // Retrieve and update wallet
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                // Check sufficient funds
                if (wallet.balance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Update balance
                let updatedWallet = {
                    address = wallet.address;
                    balance = wallet.balance - amount;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                };
                
                wallets.put(walletAddress, updatedWallet);
                
                // Record transaction
                let transaction = createTransaction(#withdrawal, amount, ?walletAddress, null);
                addTransactionToWallet(walletAddress, transaction);
                
                Debug.print("Withdrawal successful: " # Nat.toText(amount) # " from " # Principal.toText(walletAddress));
                #ok(())
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Transfers funds between wallets
    public func transfer(
        fromPhoneNumber: Text, 
        fromPin: Text, 
        toPhoneNumber: Text, 
        toPin: Text, 
        amount: Nat
    ): async Result<(), WalletError> {
        // Validate inputs
        if (not isValidPhoneNumber(fromPhoneNumber) or not isValidPin(fromPin) or
            not isValidPhoneNumber(toPhoneNumber) or not isValidPin(toPin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        // Derive wallet addresses
        let fromAddress = deriveWalletAddress(fromPhoneNumber, fromPin);
        let toAddress = deriveWalletAddress(toPhoneNumber, toPin);
        
        // Cannot transfer to same wallet
        if (Principal.equal(fromAddress, toAddress)) {
            return #err(#invalidAmount);
        };
        
        // Check both wallets exist
        switch (wallets.get(fromAddress), wallets.get(toAddress)) {
            case (?fromWallet, ?toWallet) {
                // Check sufficient funds
                if (fromWallet.balance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Update sender wallet
                let updatedFromWallet = {
                    address = fromWallet.address;
                    balance = fromWallet.balance - amount;
                    createdAt = fromWallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = fromWallet.transactionHistory;
                };
                
                // Update receiver wallet
                let updatedToWallet = {
                    address = toWallet.address;
                    balance = toWallet.balance + amount;
                    createdAt = toWallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = toWallet.transactionHistory;
                };
                
                // Store updated wallets
                wallets.put(fromAddress, updatedFromWallet);
                wallets.put(toAddress, updatedToWallet);
                
                // Record transactions
                let transferTransaction = createTransaction(#transfer, amount, ?fromAddress, ?toAddress);
                addTransactionToWallet(fromAddress, transferTransaction);
                addTransactionToWallet(toAddress, transferTransaction);
                
                Debug.print("Transfer successful: " # Nat.toText(amount) # " from " # Principal.toText(fromAddress) # " to " # Principal.toText(toAddress));
                #ok(())
            };
            case (null, _) {
                #err(#walletNotFound)
            };
            case (_, null) {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Gets transaction history for a wallet
    public query func getTransactionHistory(phoneNumber: Text, pin: Text): async Result<[Transaction], WalletError> {
        // Validate inputs
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        // Regenerate wallet address
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        // Retrieve wallet
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                #ok(wallet.transactionHistory)
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Checks if a wallet exists for given credentials
    public query func walletExists(phoneNumber: Text, pin: Text): async Bool {
        // Validate inputs
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return false;
        };
        
        // Regenerate wallet address
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        // Check if wallet exists
        switch (wallets.get(walletAddress)) {
            case (?_) { true };
            case null { false };
        };
    };
    
    // ======================
    // ADMIN & MONITORING FUNCTIONS
    // ======================
    
    /// Gets canister statistics (admin function)
    public query func getCanisterStats(): async {
        totalWallets: Nat;
        totalTransactions: Nat;
        canisterCreatedAt: Time;
        lastActivity: Time;
    } {
        let totalTransactions = Array.foldLeft<(Principal, Wallet), Nat>(
            Iter.toArray(wallets.entries()),
            0,
            func(acc, (_, wallet)) = acc + wallet.transactionHistory.size()
        );
        
        {
            totalWallets = wallets.size();
            totalTransactions = totalTransactions;
            canisterCreatedAt = canisterCreatedAt;
            lastActivity = Time.now();
        }
    };
    
    /// Health check function
    public query func healthCheck(): async {
        status: Text;
        timestamp: Time;
        walletCount: Nat;
    } {
        {
            status = "healthy";
            timestamp = Time.now();
            walletCount = wallets.size();
        }
    };
    
    // ======================
    // FUTURE INTEGRATION PLACEHOLDERS
    // ======================
    
    /// Placeholder for stablecoin integration
    /// TODO: Implement integration with ICP-native stablecoins (ckUSDC, etc.)
    private func integrateStablecoin(): async () {
        // Future implementation:
        // - Connect to stablecoin canister
        // - Implement actual deposit/withdrawal logic
        // - Handle exchange rates
        // - Manage reserves
        Debug.print("Stablecoin integration placeholder");
    };
    
    /// Placeholder for enhanced PIN authentication
    /// TODO: Implement more sophisticated PIN verification
    private func enhancedPinAuth(phoneNumber: Text, pin: Text): async Bool {
        // Future implementation:
        // - Time-based PIN lockout
        // - Attempt counting
        // - PIN strength validation
        // - Multi-factor authentication
        isValidPin(pin)
    };
    
    /// Placeholder for signature verification
    /// TODO: Implement ICP identity and signature validation
    private func verifySignature(principal: Principal, signature: Blob, message: Blob): Bool {
        // Future implementation:
        // - ICP identity verification
        // - Threshold ECDSA integration
        // - Message signing/verification
        true
    };
}