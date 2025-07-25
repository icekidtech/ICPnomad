import Debug "mo:base/Debug";
import HashMap "mo:base/HashMap";
import Principal "mo:base/Principal";
import Result "mo:base/Result";
import Text "mo:base/Text";
import Time "mo:base/Time";
import Nat "mo:base/Nat";
import Blob "mo:base/Blob";

/**
 * Custom Stablecoin Canister for Testing
 * 
 * A minimal stablecoin implementation for testing ICPNomad wallet functionality.
 * This is a simplified version for development purposes only.
 */
actor CustomStablecoin {
    
    // ======================
    // TYPE DEFINITIONS
    // ======================
    
    public type Result<T, E> = Result.Result<T, E>;
    
    public type TransferArgs = {
        to: Principal;
        amount: Nat;
        memo: ?Blob;
        from_subaccount: ?Blob;
        to_subaccount: ?Blob;
        created_at_time: ?Nat64;
    };
    
    public type TransferResult = Result<Nat, {
        #BadFee: { expected_fee: Nat };
        #BadBurn: { min_burn_amount: Nat };
        #InsufficientFunds: { balance: Nat };
        #TooOld;
        #CreatedInFuture: { ledger_time: Nat64 };
        #Duplicate: { duplicate_of: Nat };
        #TemporarilyUnavailable;
        #GenericError: { error_code: Nat; message: Text };
    }>;
    
    public type BalanceArgs = {
        account: Principal;
        subaccount: ?Blob;
    };
    
    public type TokenMetadata = {
        name: Text;
        symbol: Text;
        decimals: Nat8;
        fee: Nat;
        totalSupply: Nat;
    };
    
    // ======================
    // STATE VARIABLES
    // ======================
    
    /// Token balances for each account
    private stable var balanceEntries: [(Principal, Nat)] = [];
    private var balances = HashMap.fromIter<Principal, Nat>(
        balanceEntries.vals(),
        10,
        Principal.equal,
        Principal.hash
    );
    
    /// Transaction counter for unique IDs
    private stable var transactionCounter: Nat = 0;
    
    /// Token metadata
    private let TOKEN_NAME = "ICPNomad Test Stablecoin";
    private let TOKEN_SYMBOL = "INTS";
    private let TOKEN_DECIMALS: Nat8 = 6;
    private let TOKEN_FEE: Nat = 10000; // 0.01 tokens
    private stable var totalSupply: Nat = 1000000000000; // 1M tokens with 6 decimals
    
    /// Canister owner (for minting purposes)
    private stable var owner: Principal = Principal.fromText("rdmx6-jaaaa-aaaah-qcaiq-cai");
    
    // ======================
    // SYSTEM FUNCTIONS
    // ======================
    
    system func preupgrade() {
        balanceEntries := balances.entries() |> Iter.toArray(_);
    };
    
    system func postupgrade() {
        balanceEntries := [];
    };
    
    // ======================
    // PRIVATE FUNCTIONS
    // ======================
    
    private func getBalance(account: Principal): Nat {
        switch (balances.get(account)) {
            case (?balance) { balance };
            case null { 0 };
        }
    };
    
    private func setBalance(account: Principal, amount: Nat) {
        if (amount == 0) {
            balances.delete(account);
        } else {
            balances.put(account, amount);
        }
    };
    
    private func generateTransactionId(): Nat {
        transactionCounter += 1;
        transactionCounter
    };
    
    // ======================
    // PUBLIC FUNCTIONS
    // ======================
    
    /// Initialize the canister with the caller as owner
    public func init(): async () {
        owner := Principal.fromActor(CustomStablecoin);
        // Give owner initial supply for testing
        setBalance(owner, totalSupply);
        Debug.print("CustomStablecoin initialized with owner: " # Principal.toText(owner));
    };
    
    /// Transfer tokens between accounts
    public func transfer(args: TransferArgs): async TransferResult {
        let caller = Principal.fromActor(CustomStablecoin); // In real implementation, use msg.caller
        let from = caller;
        let to = args.to;
        let amount = args.amount;
        
        // Validate transfer
        if (amount == 0) {
            return #err(#GenericError({ error_code = 1; message = "Transfer amount must be greater than 0" }));
        };
        
        if (Principal.equal(from, to)) {
            return #err(#GenericError({ error_code = 2; message = "Cannot transfer to same account" }));
        };
        
        let fromBalance = getBalance(from);
        let totalAmount = amount + TOKEN_FEE;
        
        if (fromBalance < totalAmount) {
            return #err(#InsufficientFunds({ balance = fromBalance }));
        };
        
        // Perform transfer
        let toBalance = getBalance(to);
        
        setBalance(from, fromBalance - totalAmount);
        setBalance(to, toBalance + amount);
        
        let txId = generateTransactionId();
        Debug.print("Transfer completed: " # Nat.toText(amount) # " from " # Principal.toText(from) # " to " # Principal.toText(to));
        
        #ok(txId)
    };
    
    /// Query account balance
    public query func balance_of(args: BalanceArgs): async Nat {
        getBalance(args.account)
    };
    
    /// Get token metadata
    public query func metadata(): async TokenMetadata {
        {
            name = TOKEN_NAME;
            symbol = TOKEN_SYMBOL;
            decimals = TOKEN_DECIMALS;
            fee = TOKEN_FEE;
            totalSupply = totalSupply;
        }
    };
    
    /// Get transaction fee
    public query func fee(): async Nat {
        TOKEN_FEE
    };
    
    /// Get total supply
    public query func total_supply(): async Nat {
        totalSupply
    };
    
    /// Mint tokens (owner only, for testing)
    public func mint(to: Principal, amount: Nat): async Result<(), Text> {
        let caller = Principal.fromActor(CustomStablecoin); // In real implementation, use msg.caller
        
        if (not Principal.equal(caller, owner)) {
            return #err("Only owner can mint tokens");
        };
        
        let toBalance = getBalance(to);
        setBalance(to, toBalance + amount);
        totalSupply += amount;
        
        Debug.print("Minted " # Nat.toText(amount) # " tokens to " # Principal.toText(to));
        #ok(())
    };
    
    /// Burn tokens (owner only, for testing)
    public func burn(amount: Nat): async Result<(), Text> {
        let caller = Principal.fromActor(CustomStablecoin); // In real implementation, use msg.caller
        
        if (not Principal.equal(caller, owner)) {
            return #err("Only owner can burn tokens");
        };
        
        let callerBalance = getBalance(caller);
        if (callerBalance < amount) {
            return #err("Insufficient balance to burn");
        };
        
        setBalance(caller, callerBalance - amount);
        totalSupply -= amount;
        
        Debug.print("Burned " # Nat.toText(amount) # " tokens");
        #ok(())
    };
    
    /// Get canister stats
    public query func getStats(): async {
        totalSupply: Nat;
        totalAccounts: Nat;
        fee: Nat;
        owner: Principal;
    } {
        {
            totalSupply = totalSupply;
            totalAccounts = balances.size();
            fee = TOKEN_FEE;
            owner = owner;
        }
    };
    
    /// Health check
    public query func healthCheck(): async {
        status: Text;
        name: Text;
        symbol: Text;
        totalSupply: Nat;
    } {
        {
            status = "healthy";
            name = TOKEN_NAME;
            symbol = TOKEN_SYMBOL;
            totalSupply = totalSupply;
        }
    };
}