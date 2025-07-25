import Principal "mo:base/Principal";
import Result "mo:base/Result";

/**
 * Stablecoin Interface Module
 * 
 * Defines the interface for interacting with stablecoin canisters
 * Compatible with ckUSDC and similar ICP-native stablecoins
 */
module {
    
    public type Result<T, E> = Result.Result<T, E>;
    
    /// Standard token transfer arguments
    public type TransferArgs = {
        to: Principal;
        amount: Nat;
        memo: ?Blob;
        from_subaccount: ?Blob;
        to_subaccount: ?Blob;
        created_at_time: ?Nat64;
    };
    
    /// Transfer result
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
    
    /// Balance query arguments
    public type BalanceArgs = {
        account: Principal;
        subaccount: ?Blob;
    };
    
    /// Token metadata
    public type TokenMetadata = {
        name: Text;
        symbol: Text;
        decimals: Nat8;
        fee: Nat;
        totalSupply: Nat;
    };
    
    /// Stablecoin actor interface
    public type StablecoinActor = actor {
        /// Transfer tokens between accounts
        transfer: (TransferArgs) -> async TransferResult;
        
        /// Query account balance
        balance_of: (BalanceArgs) -> async Nat;
        
        /// Get token metadata
        metadata: () -> async TokenMetadata;
        
        /// Get transaction fee
        fee: () -> async Nat;
        
        /// Get total supply
        total_supply: () -> async Nat;
    };
    
    /// Helper function to create transfer arguments
    public func createTransferArgs(
        to: Principal,
        amount: Nat,
        memo: ?Blob
    ): TransferArgs {
        {
            to = to;
            amount = amount;
            memo = memo;
            from_subaccount = null;
            to_subaccount = null;
            created_at_time = null;
        }
    };
    
    /// Helper function to create balance query arguments
    public func createBalanceArgs(account: Principal): BalanceArgs {
        {
            account = account;
            subaccount = null;
        }
    };
}