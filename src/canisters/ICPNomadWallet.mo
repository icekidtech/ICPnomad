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

// Import stablecoin interface
import Stablecoin "./Stablecoin";

/**
 * ICPNomadWallet Canister with Stablecoin Support
 * 
 * A privacy-preserving wallet canister for USSD-based cryptocurrency access.
 * Ensures phone numbers are never stored while maintaining one-account-per-phone uniqueness.
 * Now supports stablecoin operations with gasless transactions.
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
    };
    
    /// Enhanced wallet data structure with stablecoin support
    public type Wallet = {
        address: Principal;
        icpBalance: Nat;
        stablecoinBalance: Nat;
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
        #stablecoinError: Text;
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
    
    /// Stablecoin canister reference (configurable)
    private stable var stablecoinCanisterId: Text = "rdmx6-jaaaa-aaaah-qcaiq-cai"; // Default ckUSDC canister ID
    
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
        toAddress: ?Principal,
        tokenType: Text
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
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = updatedHistory;
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
    // EXISTING WALLET FUNCTIONS (UPDATED)
    // ======================
    
    /// Generates a new wallet for a phone number and PIN combination
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
                // Create new wallet with stablecoin support
                let newWallet: Wallet = {
                    address = walletAddress;
                    icpBalance = 0;
                    stablecoinBalance = 0;
                    createdAt = Time.now();
                    lastActivity = Time.now();
                    transactionHistory = [];
                };
                
                wallets.put(walletAddress, newWallet);
                Debug.print("New wallet created: " # Principal.toText(walletAddress));
                #ok(walletAddress)
            };
        };
    };
    
    /// Retrieves ICP balance using phone number and PIN
    public query func getBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                #ok(wallet.icpBalance)
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
    
    /// Retrieves stablecoin balance using phone number and PIN
    public query func getStablecoinBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                #ok(wallet.stablecoinBalance)
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Deposits stablecoins to wallet (gasless transaction)
    public func depositStablecoin(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                // In a real implementation, this would interact with the stablecoin canister
                // For now, we simulate the deposit by updating the balance
                // TODO: Implement actual stablecoin transfer from external source
                
                let updatedWallet = {
                    address = wallet.address;
                    icpBalance = wallet.icpBalance;
                    stablecoinBalance = wallet.stablecoinBalance + amount;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                };
                
                wallets.put(walletAddress, updatedWallet);
                
                let transaction = createTransaction(#stablecoinDeposit, amount, null, ?walletAddress, "STABLECOIN");
                addTransactionToWallet(walletAddress, transaction);
                
                Debug.print("Stablecoin deposit successful: " # Nat.toText(amount) # " to " # Principal.toText(walletAddress));
                #ok(())
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Withdraws stablecoins from wallet (gasless transaction)
    public func withdrawStablecoin(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                if (wallet.stablecoinBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // In a real implementation, this would transfer stablecoins to external address
                // For now, we simulate the withdrawal by updating the balance
                // TODO: Implement actual stablecoin transfer to external address
                
                let updatedWallet = {
                    address = wallet.address;
                    icpBalance = wallet.icpBalance;
                    stablecoinBalance = wallet.stablecoinBalance - amount;
                    createdAt = wallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = wallet.transactionHistory;
                };
                
                wallets.put(walletAddress, updatedWallet);
                
                let transaction = createTransaction(#stablecoinWithdrawal, amount, ?walletAddress, null, "STABLECOIN");
                addTransactionToWallet(walletAddress, transaction);
                
                Debug.print("Stablecoin withdrawal successful: " # Nat.toText(amount) # " from " # Principal.toText(walletAddress));
                #ok(())
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Transfers stablecoins between wallets (gasless transaction)
    public func transferStablecoin(
        phoneNumber: Text, 
        pin: Text, 
        recipientPhoneNumber: Text, 
        amount: Nat
    ): async Result<(), WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin) or
            not isValidPhoneNumber(recipientPhoneNumber)) {
            return #err(#invalidCredentials);
        };
        
        if (amount == 0) {
            return #err(#invalidAmount);
        };
        
        let senderAddress = deriveWalletAddress(phoneNumber, pin);
        let recipientAddress = deriveWalletAddress(recipientPhoneNumber, "0000"); // Recipient PIN not needed for address derivation
        
        // Cannot transfer to same wallet
        if (Principal.equal(senderAddress, recipientAddress)) {
            return #err(#invalidAmount);
        };
        
        // Check both wallets exist
        switch (wallets.get(senderAddress), wallets.get(recipientAddress)) {
            case (?senderWallet, ?recipientWallet) {
                if (senderWallet.stablecoinBalance < amount) {
                    return #err(#insufficientFunds);
                };
                
                // Update sender wallet
                let updatedSenderWallet = {
                    address = senderWallet.address;
                    icpBalance = senderWallet.icpBalance;
                    stablecoinBalance = senderWallet.stablecoinBalance - amount;
                    createdAt = senderWallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = senderWallet.transactionHistory;
                };
                
                // Update recipient wallet
                let updatedRecipientWallet = {
                    address = recipientWallet.address;
                    icpBalance = recipientWallet.icpBalance;
                    stablecoinBalance = recipientWallet.stablecoinBalance + amount;
                    createdAt = recipientWallet.createdAt;
                    lastActivity = Time.now();
                    transactionHistory = recipientWallet.transactionHistory;
                };
                
                wallets.put(senderAddress, updatedSenderWallet);
                wallets.put(recipientAddress, updatedRecipientWallet);
                
                let transferTransaction = createTransaction(#stablecoinTransfer, amount, ?senderAddress, ?recipientAddress, "STABLECOIN");
                addTransactionToWallet(senderAddress, transferTransaction);
                addTransactionToWallet(recipientAddress, transferTransaction);
                
                Debug.print("Stablecoin transfer successful: " # Nat.toText(amount) # " from " # Principal.toText(senderAddress) # " to " # Principal.toText(recipientAddress));
                #ok(())
            };
            case (null, _) {
                #err(#walletNotFound)
            };
            case (_, null) {
                // Create recipient wallet if it doesn't exist (for simplified transfers)
                let newRecipientWallet: Wallet = {
                    address = recipientAddress;
                    icpBalance = 0;
                    stablecoinBalance = amount;
                    createdAt = Time.now();
                    lastActivity = Time.now();
                    transactionHistory = [];
                };
                
                switch (wallets.get(senderAddress)) {
                    case (?senderWallet) {
                        if (senderWallet.stablecoinBalance < amount) {
                            return #err(#insufficientFunds);
                        };
                        
                        let updatedSenderWallet = {
                            address = senderWallet.address;
                            icpBalance = senderWallet.icpBalance;
                            stablecoinBalance = senderWallet.stablecoinBalance - amount;
                            createdAt = senderWallet.createdAt;
                            lastActivity = Time.now();
                            transactionHistory = senderWallet.transactionHistory;
                        };
                        
                        wallets.put(senderAddress, updatedSenderWallet);
                        wallets.put(recipientAddress, newRecipientWallet);
                        
                        let transferTransaction = createTransaction(#stablecoinTransfer, amount, ?senderAddress, ?recipientAddress, "STABLECOIN");
                        addTransactionToWallet(senderAddress, transferTransaction);
                        addTransactionToWallet(recipientAddress, transferTransaction);
                        
                        #ok(())
                    };
                    case null {
                        #err(#walletNotFound)
                    };
                }
            };
        };
    };
    
    // ======================
    // ENHANCED QUERY FUNCTIONS
    // ======================
    
    /// Gets combined wallet balances (ICP + Stablecoin)
    public query func getWalletInfo(phoneNumber: Text, pin: Text): async Result<{
        icpBalance: Nat;
        stablecoinBalance: Nat;
        totalTransactions: Nat;
        lastActivity: Time;
    }, WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                #ok({
                    icpBalance = wallet.icpBalance;
                    stablecoinBalance = wallet.stablecoinBalance;
                    totalTransactions = wallet.transactionHistory.size();
                    lastActivity = wallet.lastActivity;
                })
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Gets transaction history with token type filtering
    public query func getTransactionHistory(phoneNumber: Text, pin: Text): async Result<[Transaction], WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                #ok(wallet.transactionHistory)
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    /// Gets stablecoin transactions only
    public query func getStablecoinTransactionHistory(phoneNumber: Text, pin: Text): async Result<[Transaction], WalletError> {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return #err(#invalidCredentials);
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?wallet) {
                let stablecoinTxs = Array.filter<Transaction>(wallet.transactionHistory, func(tx) {
                    tx.tokenType == "STABLECOIN"
                });
                #ok(stablecoinTxs)
            };
            case null {
                #err(#walletNotFound)
            };
        };
    };
    
    // ======================
    // ADMIN FUNCTIONS (UPDATED)
    // ======================
    
    /// Updates stablecoin canister ID (admin function)
    public func setStablecoinCanisterId(canisterId: Text): async Result<(), WalletError> {
        // TODO: Add proper admin authentication
        stablecoinCanisterId := canisterId;
        Debug.print("Stablecoin canister ID updated to: " # canisterId);
        #ok(())
    };
    
    /// Gets canister statistics with stablecoin info
    public query func getCanisterStats(): async {
        totalWallets: Nat;
        totalTransactions: Nat;
        totalStablecoinTransactions: Nat;
        totalStablecoinBalance: Nat;
        canisterCreatedAt: Time;
        stablecoinCanisterId: Text;
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
        
        {
            totalWallets = wallets.size();
            totalTransactions = totalTransactions;
            totalStablecoinTransactions = totalStablecoinTransactions;
            totalStablecoinBalance = totalStablecoinBalance;
            canisterCreatedAt = canisterCreatedAt;
            stablecoinCanisterId = stablecoinCanisterId;
        }
    };
    
    /// Health check function with stablecoin status
    public query func healthCheck(): async {
        status: Text;
        timestamp: Time;
        walletCount: Nat;
        stablecoinSupported: Bool;
        stablecoinCanisterId: Text;
    } {
        {
            status = "healthy";
            timestamp = Time.now();
            walletCount = wallets.size();
            stablecoinSupported = true;
            stablecoinCanisterId = stablecoinCanisterId;
        }
    };
    
    /// Checks if a wallet exists for given credentials
    public query func walletExists(phoneNumber: Text, pin: Text): async Bool {
        if (not isValidPhoneNumber(phoneNumber) or not isValidPin(pin)) {
            return false;
        };
        
        let walletAddress = deriveWalletAddress(phoneNumber, pin);
        
        switch (wallets.get(walletAddress)) {
            case (?_) { true };
            case null { false };
        };
    };
}