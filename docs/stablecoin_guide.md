# ICPNomad Stablecoin Integration Guide

## Overview

This guide explains the stablecoin integration for the ICPNomad wallet, enabling users to manage both ICP and stablecoin assets through USSD interfaces while maintaining privacy and gasless transactions.

## Architecture

### Multi-Token Wallet Design

The enhanced ICPNomadWallet canister now supports:
- **ICP Balance**: Native Internet Computer tokens
- **Stablecoin Balance**: ICP-native stablecoins (ckUSDC, custom tokens)
- **Unified Transaction History**: Combined history with token type identification
- **Deterministic Address Generation**: Same privacy-preserving approach for all tokens

### Privacy-Preserving Design

```motoko
// Wallet structure with multi-token support
public type Wallet = {
    address: Principal;           // Derived from phone+PIN (no storage)
    icpBalance: Nat;             // ICP token balance
    stablecoinBalance: Nat;      // Stablecoin balance
    createdAt: Time;             // Creation timestamp
    lastActivity: Time;          // Last transaction time
    transactionHistory: [Transaction]; // All transactions
};

// Enhanced transaction with token type
public type Transaction = {
    id: Text;
    txType: TransactionType;     // deposit, withdrawal, transfer variants
    amount: Nat;
    timestamp: Time;
    status: TransactionStatus;
    fromAddress: ?Principal;
    toAddress: ?Principal;
    tokenType: Text;             // "ICP" or "STABLECOIN"
};
```

## Stablecoin Functions

### Balance Management

#### `getStablecoinBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError>`
Retrieves the stablecoin balance for a wallet.

**Privacy Guarantee**: Regenerates wallet address from phone+PIN without storing credentials.

```bash
# Example usage
dfx canister call icpnomad_wallet getStablecoinBalance '("+1234567890", "1234")'
# Returns: (variant { ok = 50_000_000 : nat })  // 50 tokens with 6 decimals
```

#### `getWalletInfo(phoneNumber: Text, pin: Text): async Result<WalletInfo, WalletError>`
Returns combined wallet information including both ICP and stablecoin balances.

```bash
dfx canister call icpnomad_wallet getWalletInfo '("+1234567890", "1234")'
# Returns both ICP and stablecoin balances, transaction count, last activity
```

### Transaction Functions

#### `depositStablecoin(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError>`
Deposits stablecoins to a wallet using gasless transactions.

**Implementation Notes**:
- Uses ICP's reverse gas model (canister pays gas fees)
- Integrates with stablecoin canister for real transfers
- Currently simulated for testing, will integrate with actual stablecoin transfers

```bash
# Deposit 50 tokens (with 6 decimals)
dfx canister call icpnomad_wallet depositStablecoin '("+1234567890", "1234", 50_000_000)'
```

#### `withdrawStablecoin(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError>`
Withdraws stablecoins from a wallet with balance validation.

```bash
# Withdraw 20 tokens
dfx canister call icpnomad_wallet withdrawStablecoin '("+1234567890", "1234", 20_000_000)'
```

#### `transferStablecoin(phoneNumber: Text, pin: Text, recipientPhoneNumber: Text, amount: Nat)`
Transfers stablecoins between wallets using deterministic address generation.

**Key Features**:
- Derives both sender and recipient addresses from phone numbers
- Creates recipient wallet if it doesn't exist (simplified UX)
- Records transaction in both wallets' histories

```bash
# Transfer 15 tokens from one phone to another
dfx canister call icpnomad_wallet transferStablecoin '("+1234567890", "1234", "+0987654321", 15_000_000)'
```

### Transaction History

#### `getStablecoinTransactionHistory(phoneNumber: Text, pin: Text)`
Returns only stablecoin-related transactions.

```bash
dfx canister call icpnomad_wallet getStablecoinTransactionHistory '("+1234567890", "1234")'
```

## Stablecoin Integration Options

### Option 1: ckUSDC Integration (Recommended for Production)

ckUSDC is an ICP-native USDC token that can be integrated directly:

```motoko
// Update stablecoin canister ID for ckUSDC
private stable var stablecoinCanisterId: Text = "xkbqi-6qaaa-aaaah-qbpqq-cai";

// Integration example
let ckUSDC = actor(stablecoinCanisterId) : Stablecoin.StablecoinActor;
let transferResult = await ckUSDC.transfer({
    to = recipientAddress;
    amount = amount;
    memo = ?Text.encodeUtf8("ICPNomad transfer");
    from_subaccount = null;
    to_subaccount = null;
    created_at_time = null;
});
```

### Option 2: Custom Stablecoin (For Testing)

The included CustomStablecoin canister provides basic functionality for development:

```motoko
// CustomStablecoin features
- Minting/burning capabilities for testing
- Standard token interface compatibility
- Basic balance and transfer functions
- Configurable metadata (name, symbol, decimals)
```

## Deployment Guide

### Local Development Setup

1. **Deploy CustomStablecoin (for testing)**
```bash
dfx deploy custom_stablecoin
dfx canister call custom_stablecoin init
```

2. **Deploy Enhanced ICPNomadWallet**
```bash
dfx deploy icpnomad_wallet
```

3. **Configure Stablecoin Integration**
```bash
# Set custom stablecoin canister ID (if using custom token)
dfx canister call icpnomad_wallet setStablecoinCanisterId '"$(dfx canister id custom_stablecoin)"'
```

4. **Run Comprehensive Tests**
```bash
chmod +x test_stablecoin.sh
./test_stablecoin.sh
```

### Production Deployment with ckUSDC

1. **Update Configuration**
```motoko
// In ICPNomadWallet.mo, update the default canister ID
private stable var stablecoinCanisterId: Text = "xkbqi-6qaaa-aaaah-qbpqq-cai"; // ckUSDC
```

2. **Deploy to IC Mainnet**
```bash
dfx deploy --network ic icpnomad_wallet
```

3. **Verify Integration**
```bash
dfx canister --network ic call icpnomad_wallet healthCheck
```

## Testing Scenarios

### Basic Stablecoin Operations

```bash
# Create wallets
dfx canister call icpnomad_wallet generateWallet '("+1234567890", "1234")'
dfx canister call icpnomad_wallet generateWallet '("+0987654321", "5678")'

# Check initial balances
dfx canister call icpnomad_wallet getStablecoinBalance '("+1234567890", "1234")'

# Deposit stablecoins
dfx canister call icpnomad_wallet depositStablecoin '("+1234567890", "1234", 50_000_000)'

# Transfer between wallets
dfx canister call icpnomad_wallet transferStablecoin '("+1234567890", "1234", "+0987654321", 25_000_000)'

# Check balances and history
dfx canister call icpnomad_wallet getWalletInfo '("+1234567890", "1234")'
dfx canister call icpnomad_wallet getStablecoinTransactionHistory '("+1234567890", "1234")'
```

### Privacy Verification

```bash
# Verify same credentials produce same wallet
dfx canister call icpnomad_wallet getStablecoinBalance '("+1234567890", "1234")'
dfx canister call# ICPNomad Stablecoin Integration Guide

## Overview

This guide explains the stablecoin integration for the ICPNomad wallet, enabling users to manage both ICP and stablecoin assets through USSD interfaces while maintaining privacy and gasless transactions.

## Architecture

### Multi-Token Wallet Design

The enhanced ICPNomadWallet canister now supports:
- **ICP Balance**: Native Internet Computer tokens
- **Stablecoin Balance**: ICP-native stablecoins (ckUSDC, custom tokens)
- **Unified Transaction History**: Combined history with token type identification
- **Deterministic Address Generation**: Same privacy-preserving approach for all tokens

### Privacy-Preserving Design

```motoko
// Wallet structure with multi-token support
public type Wallet = {
    address: Principal;           // Derived from phone+PIN (no storage)
    icpBalance: Nat;             // ICP token balance
    stablecoinBalance: Nat;      // Stablecoin balance
    createdAt: Time;             // Creation timestamp
    lastActivity: Time;          // Last transaction time
    transactionHistory: [Transaction]; // All transactions
};

// Enhanced transaction with token type
public type Transaction = {
    id: Text;
    txType: TransactionType;     // deposit, withdrawal, transfer variants
    amount: Nat;
    timestamp: Time;
    status: TransactionStatus;
    fromAddress: ?Principal;
    toAddress: ?Principal;
    tokenType: Text;             // "ICP" or "STABLECOIN"
};
```

## Stablecoin Functions

### Balance Management

#### `getStablecoinBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError>`
Retrieves the stablecoin balance for a wallet.

**Privacy Guarantee**: Regenerates wallet address from phone+PIN without storing credentials.

```bash
# Example usage
dfx canister call icpnomad_wallet getStablecoinBalance '("+1234567890", "1234")'
# Returns: (variant { ok = 50_000_000 : nat })  // 50 tokens with 6 decimals
```

#### `getWalletInfo(phoneNumber: Text, pin: Text): async Result<WalletInfo, WalletError>`
Returns combined wallet information including both ICP and stablecoin balances.

```bash
dfx canister call icpnomad_wallet getWalletInfo '("+1234567890", "1234")'
# Returns both ICP and stablecoin balances, transaction count, last activity
```

### Transaction Functions

#### `depositStablecoin(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError>`
Deposits stablecoins to a wallet using gasless transactions.

**Implementation Notes**:
- Uses ICP's reverse gas model (canister pays gas fees)
- Integrates with stablecoin canister for real transfers
- Currently simulated for testing, will integrate with actual stablecoin transfers

```bash
# Deposit 50 tokens (with 6 decimals)
dfx canister call icpnomad_wallet depositStablecoin '("+1234567890", "1234", 50_000_000)'
```

#### `withdrawStablecoin(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError>`
Withdraws stablecoins from a wallet with balance validation.

```bash
# Withdraw 20 tokens
dfx canister call icpnomad_wallet withdrawStablecoin '("+1234567890", "1234", 20_000_000)'
```

#### `transferStablecoin(phoneNumber: Text, pin: Text, recipientPhoneNumber: Text, amount: Nat)`
Transfers stablecoins between wallets using deterministic address generation.

**Key Features**:
- Derives both sender and recipient addresses from phone numbers
- Creates recipient wallet if it doesn't exist (simplified UX)
- Records transaction in both wallets' histories

```bash
# Transfer 15 tokens from one phone to another
dfx canister call icpnomad_wallet transferStablecoin '("+1234567890", "1234", "+0987654321", 15_000_000)'
```

### Transaction History

#### `getStablecoinTransactionHistory(phoneNumber: Text, pin: Text)`
Returns only stablecoin-related transactions.

```bash
dfx canister call icpnomad_wallet getStablecoinTransactionHistory '("+1234567890", "1234")'
```

## Stablecoin Integration Options

### Option 1: ckUSDC Integration (Recommended for Production)

ckUSDC is an ICP-native USDC token that can be integrated directly:

```motoko
// Update stablecoin canister ID for ckUSDC
private stable var stablecoinCanisterId: Text = "xkbqi-6qaaa-aaaah-qbpqq-cai";

// Integration example
let ckUSDC = actor(stablecoinCanisterId) : Stablecoin.StablecoinActor;
let transferResult = await ckUSDC.transfer({
    to = recipientAddress;
    amount = amount;
    memo = ?Text.encodeUtf8("ICPNomad transfer");
    from_subaccount = null;
    to_subaccount = null;
    created_at_time = null;
});
```

### Option 2: Custom Stablecoin (For Testing)

The included CustomStablecoin canister provides basic functionality for development:

```motoko
// CustomStablecoin features
- Minting/burning capabilities for testing
- Standard token interface compatibility
- Basic balance and transfer functions
- Configurable metadata (name, symbol, decimals)
```

## Deployment Guide

### Local Development Setup

1. **Deploy CustomStablecoin (for testing)**
```bash
dfx deploy custom_stablecoin
dfx canister call custom_stablecoin init
```

2. **Deploy Enhanced ICPNomadWallet**
```bash
dfx deploy icpnomad_wallet
```

3. **Configure Stablecoin Integration**
```bash
# Set custom stablecoin canister ID (if using custom token)
dfx canister call icpnomad_wallet setStablecoinCanisterId '"$(dfx canister id custom_stablecoin)"'
```

4. **Run Comprehensive Tests**
```bash
chmod +x test_stablecoin.sh
./test_stablecoin.sh
```

### Production Deployment with ckUSDC

1. **Update Configuration**
```motoko
// In ICPNomadWallet.mo, update the default canister ID
private stable var stablecoinCanisterId: Text = "xkbqi-6qaaa-aaaah-qbpqq-cai"; // ckUSDC
```

2. **Deploy to IC Mainnet**
```bash
dfx deploy --network ic icpnomad_wallet
```

3. **Verify Integration**
```bash
dfx canister --network ic call icpnomad_wallet healthCheck
```

## Testing Scenarios

### Basic Stablecoin Operations

```bash
# Create wallets
dfx canister call icpnomad_wallet generateWallet '("+1234567890", "1234")'
dfx canister call icpnomad_wallet generateWallet '("+0987654321", "5678")'

# Check initial balances
dfx canister call icpnomad_wallet getStablecoinBalance '("+1234567890", "1234")'

# Deposit stablecoins
dfx canister call icpnomad_wallet depositStablecoin '("+1234567890", "1234", 50_000_000)'

# Transfer between wallets
dfx canister call icpnomad_wallet transferStablecoin '("+1234567890", "1234", "+0987654321", 25_000_000)'

# Check balances and history
dfx canister call icpnomad_wallet getWalletInfo '("+1234567890", "1234")'
dfx canister call icpnomad_wallet getStablecoinTransactionHistory '("+1234567890", "1234")'
```

### Privacy Verification

```bash
# Verify same credentials produce same wallet
dfx canister call icpnomad_wallet getStablecoinBalance '("+1234567890", "1234")'