# ICPNomad

## Overview

**ICPNomad** is a blockchain-based wallet application enabling cryptocurrency access via USSD (Unstructured Supplementary Service Data) interfaces on feature phones. It promotes financial inclusion by allowing users without smartphones to access and use digital assets on the Internet Computer (ICP) blockchain.

## Features

### USSD Interface
- **Menu-based Navigation:** Account creation, balance checks, deposits, and withdrawals via USSD menus.
- **PIN-based Security:** 4-digit PIN authentication for transactions.
- **Mock USSD CLI:** Test USSD interactions without telecom integration.

### Blockchain Integration
- **ICP Canisters:** Smart contracts written in Motoko.
- **Stablecoin Support:** ICP-native stablecoin equivalents (wrapped or custom tokens).
- **Canister Logic:** Secure asset management via ICPNomadWallet canister.

### Wallet Management
- **Deterministic Wallet Generation:** Wallets derived from phone number and PIN using ICP cryptography.
- **No Private Key Storage:** Keys regenerated on-demand, never stored.
- **Gasless Transactions:** ICP canisters cover transaction costs.

### Security Features
- **Hashed User Data:** Phone numbers and PINs stored as hashes.
- **PIN Authentication:** Required for sensitive operations.
- **Signature Verification:** ICP identity and signature validation.

### Payment Services
- **Mock Payment Integration:** Simulated local payment provider integration.
- **Deposit/Withdrawal Flow:** Fiat-to-crypto workflow using ICP ledger.

### Database Models
- **User Model:** Stores identifiers and authentication data.
- **Wallet Model:** Manages addresses and balances.
- **Transaction Model:** Records deposit, withdrawal, and transfer activities.

## Technical Stack

- **Backend:** Node.js, Express, TypeScript
- **Canisters:** Motoko (ICP smart contracts)
- **Database:** ICP canister storage; optional MongoDB
- **Blockchain:** DFINITY Canister SDK (`dfx`)
- **Logging:** Winston
- **API:** RESTful endpoints
- **Tools:** DFINITY `dfx` CLI

## Getting Started

### Prerequisites

- Node.js (v16+)
- DFINITY Canister SDK (`dfx` v0.15+)
- Optional: MongoDB
- ICP local development or mainnet access

### Installation

```bash
# Clone the repository
git clone <repository-url>

# Install dependencies
npm install

# Install DFINITY Canister SDK (dfx)
npm install -g @dfinity/dfx

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Start local ICP replica
dfx start --background

# Deploy canisters
dfx deploy

# Build the application
npm run build

# Start the server
npm start

# For development with hot reload
npm run dev

# To test the USSD interface
npm run mock-ussd
```

## Architecture

- **canisters:** Motoko smart contracts for wallet and transaction logic
- **config:** Application configuration and logging
- **controllers:** API handlers for USSD and canister interactions
- **middlewares:** Express middleware for validation and authentication
- **models:** Data models for MongoDB and canister storage
- **routes:** API route definitions
- **services:** Business logic for wallet and payments
- **ussd:** USSD service implementation

## Future Enhancements

- Integration with actual USSD service providers
- Support for additional ICP-native tokens
- Enhanced security with ICP’s threshold ECDSA
- Web admin interface using ICP Internet Identity
- Cross-canister scalability for multi-region deployments

