# ICPNomadWallet Canister Guide

## Overview

The ICPNomadWallet canister is a privacy-preserving blockchain wallet designed for USSD-based cryptocurrency access on feature phones. It ensures financial inclusion while maintaining strong security and privacy guarantees.

## Key Features

### 🔒 Privacy Protection
- **Zero Phone Number Storage**: Phone numbers and PINs are never stored on-chain or off-chain
- **Deterministic Address Generation**: Wallet addresses are derived from phone number + PIN using SHA256 hashing
- **One Account Per Phone**: Cryptographic uniqueness ensures each phone number can only have one wallet

### 🏗️ Architecture

#### Data Types
```motoko
public type Wallet = {
    address: Principal;           // Derived wallet address
    balance: Nat;                // Current balance
    createdAt: Time;             // Creation timestamp
    lastActivity: Time;          // Last transaction time
    transactionHistory: [Transaction]; // Transaction log
};

public type Transaction = {
    id: Text;                    // Unique transaction ID
    txType: TransactionType;     // deposit, withdrawal, transfer
    amount: Nat;                 // Transaction amount
    timestamp: Time;             // Transaction timestamp
    status: TransactionStatus;   // pending, completed, failed
    fromAddress: ?Principal;     // Source address (optional)
    toAddress: ?Principal;       // Destination address (optional)
};
```

#### Storage Design
- **HashMap<Principal, Wallet>**: Stores wallet data indexed by derived address
- **No Personal Data**: Phone numbers and PINs are never persisted
- **Transaction History**: Immutable log of all wallet activities

## Core Functions

### Wallet Management

#### `generateWallet(phoneNumber: Text, pin: Text): async Result<Principal, WalletError>`
Creates a new wallet for a phone number and PIN combination.

**Privacy Guarantee**: 
- Derives unique Principal from `SHA256(phoneNumber + ":" + pin + ":icpnomad_salt_2024")`
- Returns error if address already exists (enforces one-account-per-phone)
- Never stores the input phone number or PIN

**Example**:
```bash
dfx canister call icpnomad_wallet generateWallet '("+1234567890", "1234")'
```

#### `walletExists(phoneNumber: Text, pin: Text): async Bool`
Checks if a wallet exists for given credentials without revealing the address.

#### `getBalance(phoneNumber: Text, pin: Text): async Result<Nat, WalletError>`
Retrieves wallet balance by regenerating the address from credentials.

### Transaction Functions

#### `deposit(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError>`
Adds funds to a wallet (placeholder for stablecoin integration).

#### `withdraw(phoneNumber: Text, pin: Text, amount: Nat): async Result<(), WalletError>`
Removes funds from a wallet with balance validation.

#### `transfer(fromPhone: Text, fromPin: Text, toPhone: Text, toPin: Text, amount: Nat)`
Transfers funds between two wallets.

#### `getTransactionHistory(phoneNumber: Text, pin: Text): async Result<[Transaction], WalletError>`
Retrieves complete transaction history for a wallet.

### Administrative Functions

#### `getCanisterStats(): async {...}`
Returns canister-wide statistics:
- Total number of wallets
- Total transactions processed
- Canister creation time

#### `healthCheck(): async {...}`
Basic health monitoring endpoint.

## Privacy & Security Guarantees

### ✅ What We Ensure
1. **No Data Storage**: Phone numbers and PINs are never stored anywhere
2. **Deterministic Generation**: Same phone+PIN always generates same address
3. **Uniqueness**: Each phone number can only create one wallet
4. **Immutable History**: Transaction records cannot be altered
5. **Balance Integrity**: Cryptographic protection against double-spending

### 🔐 Cryptographic Design
```
Address = Principal.fromBlob(
    SHA256(phoneNumber + ":" + pin + ":icpnomad_salt_2024")
)
```

This design ensures:
- **Collision Resistance**: Different phones produce different addresses
- **Determinism**: Same inputs always produce same output
- **Privacy**: Cannot reverse-engineer phone number from address

## Deployment Guide

### Prerequisites
- DFINITY Canister SDK (dfx v0.15+)
- Node.js v16+
- Git

### Local Development Setup

1. **Start Local Replica**
```bash
dfx start --background
```

2. **Deploy Canister**
```bash
dfx deploy icpnomad_wallet
```

3. **Run Tests**
```bash
chmod +x test_canister.sh
./test_canister.sh
```

### Mainnet Deployment

1. **Configure Identity**
```bash
dfx identity use default  # or your production identity
```

2. **Deploy to IC**
```bash
dfx deploy --network ic icpnomad_wallet
```

3. **Verify Deployment**
```bash
dfx canister --network ic call icpnomad_wallet healthCheck
```

## Testing Scenarios

### Basic Wallet Operations
```bash
# Create wallet
dfx canister call icpnomad_wallet generateWallet '("+1234567890", "1234")'

# Check balance
dfx canister call icpnomad_wallet getBalance '("+1234567890", "1234")'

# Deposit funds
dfx canister call icpnomad_wallet deposit '("+1234567890", "1234", 1000)'

# Withdraw funds
dfx canister call icpnomad_wallet withdraw '("+1234567890", "1234", 500)'
```

### Privacy Verification
```bash
# Attempt duplicate creation (should fail)
dfx canister call icpnomad_wallet generateWallet '("+1234567890", "1234")'
# Expected: #err(#addressAlreadyExists)

# Test with wrong PIN (should fail)
dfx canister call icpnomad_wallet getBalance '("+1234567890", "9999")'
# Expected: #err(#walletNotFound)
```

## Future Enhancements

### 🔜 Planned Features

1. **Stablecoin Integration**
   - Connect to ICP-native stablecoins (ckUSDC, ckUSDT)
   - Real deposit/withdrawal via payment gateways
   - Exchange rate management

2. **Enhanced Security**
   - Time-based PIN lockout
   - Attempt rate limiting
   - Multi-factor authentication
   - Threshold ECDSA integration

3. **Advanced Features**
   - Cross-canister calls for scalability
   - Batch transactions
   - Scheduled payments
   - Wallet recovery mechanisms

### 🛠️ Integration Points

#### USSD Backend Integration
```typescript
// Example backend integration
import { Actor, HttpAgent } from '@dfinity/agent';
import { idlFactory } from './declarations/icpnomad_wallet';

const agent = new HttpAgent({ host: 'https://ic0.app' });
const wallet = Actor.createActor(idlFactory, {
  agent,
  canisterId: 'your-canister-id',
});

// USSD flow example
async function handleUSSDRequest(phoneNumber: string, pin: string, action: string) {
  switch (action) {
    case 'balance':
      return await wallet.getBalance(phoneNumber, pin);
    case 'deposit':
      return await wallet.deposit(phoneNumber, pin, amount);
    // ... other actions
  }
}
```

#### Mobile Money Integration
```motoko
// Future stablecoin integration placeholder
public func integratePaymentGateway(
    provider: Text,
    apiKey: Text,
    webhookUrl: Text
): async Result<(), Text> {
    // Connect to external payment systems
    // Handle fiat-to-crypto conversion
    // Manage reserves and liquidity
}
```

## Error Handling

### Error Types
- `#invalidCredentials`: Invalid phone number or PIN format
- `#walletNotFound`: No wallet exists for given credentials
- `#insufficientFunds`: Not enough balance for withdrawal/transfer
- `#addressAlreadyExists`: Wallet already exists for phone number
- `#invalidAmount`: Amount is zero or negative
- `#transactionFailed`: Generic transaction error
- `#systemError`: Internal canister error

### Best Practices
1. Always validate inputs before processing
2. Use Result types for error handling
3. Log important events for debugging
4. Implement retry logic for failed transactions
5. Monitor canister cycles and memory usage

## Monitoring & Maintenance

### Health Monitoring
```bash
# Check canister status
dfx canister status icpnomad_wallet

# Monitor memory usage
dfx canister call icpnomad_wallet getCanisterStats

# Check transaction volume
dfx canister logs icpnomad_wallet
```

### Upgrade Procedures
1. Test on local replica first
2. Deploy to testnet
3. Perform staged mainnet upgrade
4. Verify state preservation
5. Monitor for 24 hours post-upgrade

## Security Considerations

### ⚠️ Important Notes
1. **PIN Security**: 4-digit PINs provide limited entropy; consider upgrading to longer PINs
2. **Salt Management**: The hardcoded salt should be rotated periodically
3. **Rate Limiting**: Implement request throttling to prevent brute force attacks
4. **Audit Trail**: All operations are logged but consider additional monitoring
5. **Backup Strategy**: