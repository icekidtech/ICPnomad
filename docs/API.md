# ICPNomad Backend API Guide

## Overview

The ICPNomad backend is a Node.js/Express API server that provides USSD-compatible endpoints for blockchain wallet operations on the Internet Computer (ICP). The backend ensures complete privacy by never storing phone numbers and leverages ICP's reverse gas model for gasless transactions.

## Architecture

### Backend Structure

```
src/
├── index.ts                    # Main Express server entry point
├── routes/
│   └── ussd.ts                # USSD API route handlers
├── services/
│   ├── canisterService.ts     # ICP canister interaction layer
│   └── cryptoService.ts       # Phone number hashing utilities
├── middleware/
│   ├── auth.ts                # PIN validation middleware
│   ├── validation.ts          # Request validation middleware
│   └── rateLimiter.ts         # Rate limiting middleware
├── config/
│   ├── logger.ts              # Winston logging configuration
│   └── database.ts            # Database connection (optional)
└── types/
    └── api.ts                 # TypeScript interface definitions
```

### Key Components

#### 1. Main Server (index.ts)
- Express.js application setup
- Middleware configuration (CORS, helmet, rate limiting)
- Route registration
- Error handling
- Health check endpoint

#### 2. USSD Routes (routes/ussd.ts)
- `POST /ussd/create-account` - Create new wallet account
- `POST /ussd/balance` - Check account balance
- `POST /ussd/deposit` - Initiate deposit transaction
- `POST /ussd/withdraw` - Process withdrawal request
- `POST /ussd/transfer` - Transfer funds between accounts

#### 3. Canister Service (services/canisterService.ts)
- Manages connections to ICPNomadWallet canister
- Handles Principal generation from phone number hashes
- Executes canister methods for wallet operations
- Manages authentication and error handling

#### 4. Logging Configuration (config/logger.ts)
- Winston-based structured logging
- Privacy-compliant log formatting (no phone numbers)
- Multiple log levels and transports
- Request ID tracking for audit trails

## Setup and Installation

### Prerequisites

- Node.js v16+ and npm
- DFX (DFINITY Canister SDK)
- Local ICP replica or access to IC network

### Installation Steps

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start local ICP replica:**
   ```bash
   dfx start --background
   ```

4. **Deploy ICPNomadWallet canister:**
   ```bash
   dfx deploy ICPNomadWallet
   ```

5. **Update canister ID in .env:**
   ```bash
   # Get canister ID from dfx output
   echo "CANISTER_ID_ICPNOMADWALLET=$(dfx canister id ICPNomadWallet)" >> .env
   ```

6. **Build and start the backend:**
   ```bash
   npm run build
   npm start
   ```

   Or for development with hot reload:
   ```bash
   npm run dev
   ```

## Privacy Implementation

### Phone Number Handling

The backend implements strict privacy measures:

1. **No Storage**: Phone numbers are never stored in memory, logs, or databases
2. **Deterministic Hashing**: Phone numbers are immediately hashed to generate consistent account identifiers
3. **Salt Protection**: Uses environment-specific salt for additional security
4. **One-to-One Mapping**: Each phone number maps to exactly one account through canister logic

### Hashing Process

```typescript
// Pseudocode - actual implementation in cryptoService.ts
function generateAccountId(phoneNumber: string): string {
  const salt = process.env.PHONE_HASH_SECRET;
  const hash = sha256(phoneNumber + salt);
  return hash.substring(0, 32); // Principal-compatible format
}
```

## API Endpoints

### 1. Create Account
**Endpoint:** `POST /ussd/create-account`

**Request:**
```json
{
  "phoneNumber": "+254700123456",
  "pin": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "accountId": "abc123...",
  "message": "Account created successfully"
}
```

### 2. Check Balance
**Endpoint:** `POST /ussd/balance`

**Request:**
```json
{
  "phoneNumber": "+254700123456",
  "pin": "1234"
}
```

**Response:**
```json
{
  "success": true,
  "balance": "25.50",
  "currency": "ckUSDC"
}
```

### 3. Deposit Funds
**Endpoint:** `POST /ussd/deposit`

**Request:**
```json
{
  "phoneNumber": "+254700123456",
  "pin": "1234",
  "amount": "10.00"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "txn_abc123",
  "paymentInstructions": "Send money to M-Pesa: 12345"
}
```

### 4. Withdraw Funds
**Endpoint:** `POST /ussd/withdraw`

**Request:**
```json
{
  "phoneNumber": "+254700123456",
  "pin": "1234",
  "amount": "5.00"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "txn_def456",
  "estimatedTime": "5-10 minutes"
}
```

### 5. Transfer Funds
**Endpoint:** `POST /ussd/transfer`

**Request:**
```json
{
  "phoneNumber": "+254700123456",
  "pin": "1234",
  "recipientPhone": "+254700654321",
  "amount": "2.50"
}
```

**Response:**
```json
{
  "success": true,
  "transactionId": "txn_ghi789",
  "recipientConfirmed": true
}
```

## Testing the API

### Using DFX and Local Replica

1. **Start local replica:**
   ```bash
   dfx start --clean --background
   ```

2. **Deploy canister:**
   ```bash
   dfx deploy ICPNomadWallet
   ```

3. **Test canister directly:**
   ```bash
   # Create account via canister
   dfx canister call ICPNomadWallet createAccount '("phone_hash_123", "pin_hash_456")'
   
   # Check balance
   dfx canister call ICPNomadWallet getBalance '("phone_hash_123")'
   ```

### Using cURL for API Testing

1. **Create account:**
   ```bash
   curl -X POST http://localhost:3000/ussd/create-account \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber": "+254700123456", "pin": "1234"}'
   ```

2. **Check balance:**
   ```bash
   curl -X POST http://localhost:3000/ussd/balance \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber": "+254700123456", "pin": "1234"}'
   ```

3. **Initiate deposit:**
   ```bash
   curl -X POST http://localhost:3000/ussd/deposit \
     -H "Content-Type: application/json" \
     -d '{"phoneNumber": "+254700123456", "pin": "1234", "amount": "10.00"}'
   ```

### Running Automated Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- test_backend.ts
```

## Canister Interaction

### DFINITY Agent Configuration

The backend uses `@dfinity/agent` to communicate with the ICPNomadWallet canister:

```typescript
import { Agent, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';

const agent = new HttpAgent({
  host: process.env.ICP_HOST
});

// For local development only
if (process.env.NODE_ENV === 'development') {
  agent.fetchRootKey();
}
```

### Gasless Transaction Model

ICP's reverse gas model ensures users never pay transaction fees:

- **Canister Pays**: The ICPNomadWallet canister covers all transaction costs
- **User Experience**: Users interact normally without gas concerns
- **Cycle Management**: Canister requires sufficient cycles for operation

## Security Considerations

### PIN Validation
- PINs are hashed using bcrypt before canister submission
- Minimum 4 digits, no sequential or repeated patterns
- Rate limiting prevents brute force attacks

### Request Validation
- All inputs validated using Joi schemas
- Phone number format validation (E.164)
- Amount validation with min/max limits

### Rate Limiting
- Per-IP rate limiting (100 requests per 15 minutes)
- Per-endpoint specific limits
- Exponential backoff for repeated failures

## Future Development

### USSD Integration
1. **USSD Gateway**: Integrate with telecom provider USSD gateways
2. **Session Management**: Implement USSD session state handling
3. **Menu Navigation**: Build hierarchical USSD menu system
4. **Internationalization**: Support multiple languages

### Payment Provider Integration
1. **M-Pesa Integration**: Connect with Safaricom M-Pesa API
2. **Airtel Money**: Support additional mobile money providers
3. **Bank Integration**: Connect with local bank APIs
4. **Exchange Rates**: Real-time fiat-to-crypto conversion

### Enhanced Features
1. **Transaction History**: Provide detailed transaction logs
2. **Recurring Payments**: Support scheduled transactions
3. **Multi-Currency**: Support multiple stablecoins
4. **Analytics**: Usage and performance monitoring

### Scaling Considerations
1. **Load Balancing**: Horizontal scaling with multiple instances
2. **Caching**: Redis for session and temporary data
3. **Database**: Optional MongoDB for analytics (no PII)
4. **Monitoring**: Comprehensive logging and alerting

## Troubleshooting

### Common Issues

1. **Canister Connection Failed**
   ```bash
   # Check DFX status
   dfx ping
   
   # Restart replica
   dfx stop && dfx start --clean
   ```

2. **Authentication Errors**
   ```bash
   # Regenerate identity
   dfx identity new test_identity
   dfx identity use test_identity
   ```

3. **Environment Variables**
   ```bash
   # Verify canister ID
   dfx canister id ICPNomadWallet
   
   # Check .env file
   cat .env | grep CANISTER_ID
   ```

### Debug Mode

Enable verbose logging:
```bash
LOG_LEVEL=debug npm run dev
```

### Health Checks

Monitor backend health:
```bash
curl http://localhost:3000/health
```

## Contributing

1. Follow TypeScript best practices
2. Maintain privacy compliance (no phone number storage)
3. Add tests for new features
4. Update documentation for API changes
5. Use conventional commit messages

## License

MIT License - see LICENSE file for details.