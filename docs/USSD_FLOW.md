# ICPNomad USSD Development Guide

## Overview

The ICPNomad USSD system provides blockchain wallet functionality through Unstructured Supplementary Service Data (USSD) menus, enabling feature phone users to access cryptocurrency services without internet connectivity. This guide covers the USSD service architecture, testing procedures, and integration pathways.

## USSD Architecture

### System Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Feature Phone │    │  USSD Gateway   │    │  ICPNomad API   │
│                 │◄──►│                 │◄──►│                 │
│  User dials     │    │  Telecom        │    │  Express.js     │
│  *123#          │    │  Provider       │    │  Backend        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────┐
                                              │ ICPNomadWallet  │
                                              │    Canister     │
                                              │  (Motoko/ICP)   │
                                              └─────────────────┘
```

### Core Components

1. **USSD Service (`ussdService.ts`)**: Menu system and session management
2. **Mock CLI (`mock-ussd.ts`)**: Development testing interface
3. **Backend API**: HTTP endpoints for wallet operations
4. **ICP Canister**: Blockchain wallet implementation

## USSD Menu Structure

### Main Menu Hierarchy

```
ICPNomad Wallet
├── 1. Create Account
│   ├── Enter PIN (4 digits)
│   ├── Confirm PIN
│   └── Account Creation Confirmation
├── 2. Check Balance
│   ├── Enter PIN
│   └── Display Balance
├── 3. Deposit Funds
│   ├── Enter PIN
│   ├── Enter Amount
│   ├── Confirm Transaction
│   └── Payment Instructions
├── 4. Withdraw Funds
│   ├── Enter PIN
│   ├── Enter Amount
│   ├── Confirm Transaction
│   └── Processing Confirmation
└── 5. Transfer Funds
    ├── Enter PIN
    ├── Enter Recipient Phone
    ├── Enter Amount
    ├── Confirm Transaction
    └── Transfer Confirmation
```

### Session Flow Logic

1. **Session Initiation**: User dials USSD code (*123#)
2. **Main Menu Display**: Service shows menu options (1-5)
3. **Menu Navigation**: User selects option and follows prompts
4. **Data Collection**: Service collects required information step-by-step
5. **API Integration**: Backend calls are made to process requests
6. **Result Display**: Success/error messages shown to user
7. **Session Termination**: Session ends automatically or by user choice

## USSD Service Implementation

### Key Features

#### Privacy-First Design
- **No Storage**: Phone numbers and PINs never stored in memory or logs
- **Deterministic Generation**: Account addresses generated from phone number hashes
- **Session-Only Data**: Sensitive information exists only during active sessions
- **Automatic Cleanup**: Sessions expire and data is purged

#### Session Management
```typescript
interface USSDSession {
  sessionId: string;
  phoneNumber?: string;  // Only during active session
  currentMenu: string;
  step: number;
  data: Record<string, any>;
  timestamp: Date;
  lastActivity: Date;
}
```

#### Menu State Machine
- **State Tracking**: Maintains user position in menu hierarchy
- **Input Validation**: Validates PINs, phone numbers, and amounts
- **Error Handling**: Graceful handling of invalid inputs and API failures
- **Timeout Management**: Automatic session cleanup after inactivity

### API Integration

The USSD service integrates with backend endpoints:

```typescript
// Account creation
POST /ussd/create-account
{
  "phoneNumber": "+254700123456",
  "pin": "1234"
}

// Balance check
POST /ussd/balance
{
  "phoneNumber": "+254700123456",
  "pin": "1234"
}

// Deposit initiation
POST /ussd/deposit
{
  "phoneNumber": "+254700123456",
  "pin": "1234",
  "amount": "10.00"
}

// Withdrawal processing
POST /ussd/withdraw
{
  "phoneNumber": "+254700123456",
  "pin": "1234",
  "amount": "5.00"
}

// Fund transfer
POST /ussd/transfer
{
  "phoneNumber": "+254700123456",
  "pin": "1234",
  "recipientPhoneNumber": "+254700654321",
  "amount": "2.50"
}
```

## Development and Testing

### Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start local ICP replica:**
   ```bash
   dfx start --background
   ```

4. **Deploy canisters:**
   ```bash
   dfx deploy
   ```

5. **Start backend API:**
   ```bash
   npm run dev
   ```

### Mock USSD CLI Testing

#### Starting the Mock CLI

```bash
# Run mock USSD interface
npm run mock-ussd

# Or directly with ts-node
npx ts-node src/ussd/mock-ussd.ts
```

#### CLI Features

- **Interactive Interface**: Command-line simulation of USSD menus
- **Session Management**: Full session lifecycle testing
- **Privacy Validation**: Ensures no phone number storage
- **Error Simulation**: Test error handling and edge cases
- **Real-time Testing**: Direct integration with USSD service

#### Sample Testing Session

```bash
$ npm run mock-ussd

🚀 Starting ICPNomad USSD Mock CLI...

=== ICPNomad USSD Mock CLI ===

🔐 Blockchain Wallet for Feature Phones
Simulating USSD interface for testing

📱 Instructions:
  • Type a phone number to start a USSD session (e.g., +254700123456)
  • Use commands: help, quit, clear, sessions
  • Follow USSD prompts during active sessions
  • Phone numbers and PINs are never stored

Enter phone number or command> +254700123456

🔄 Starting USSD session for +254***456
Session ID: mock_session_1_1690234567890

📡 Processing USSD request...

┌─ USSD Response ─────────────────────┐
│ Welcome to ICPNomad Wallet          │
│                                      │
│ 1. Create Account                    │
│ 2. Check Balance                     │
│ 3. Deposit Funds                     │
│ 4. Withdraw Funds                    │
│ 5. Transfer Funds                    │
│                                      │
│ Select an option:                    │
└─────────────────────────────────────┘

USSD Input> 1

┌─ USSD Response ─────────────────────┐
│ Create New Account                   │
│                                      │
│ Enter your 4-digit PIN:              │
└─────────────────────────────────────┘

USSD Input> 1234

┌─ USSD Response ─────────────────────┐
│ Confirm your PIN:                    │
└─────────────────────────────────────┘

USSD Input> 1234

📡 Processing USSD request...

┌─ USSD Response ─────────────────────┐
│ Account created successfully!        │
│                                      │
│ Your wallet is ready for use.        │
│                                      │
│ Press any key to return to main     │
│ menu.                                │
└─────────────────────────────────────┘

📱 USSD session ended by service

🔚 Session mock_session_1_1690234567890 ended
   Duration: 45 seconds
```

#### Available CLI Commands

```bash
# Show help
help

# View session information
sessions

# Clear screen
clear

# End current session
end

# Exit CLI
quit
```

### Testing Scenarios

#### 1. Account Creation Flow
```bash
Phone: +254700123456
PIN: 1234 (confirm 1234)
Expected: Account created successfully
```

#### 2. Balance Check Flow
```bash
Phone: +254700123456
PIN: 1234
Expected: Display current balance
```

#### 3. Transfer Flow
```bash
Phone: +254700123456
PIN: 1234
Recipient: +254700654321
Amount: 5.00
Expected: Transfer confirmation
```

#### 4. Error Handling Tests
```bash
# Invalid phone number
Phone: 123456789
Expected: "Invalid phone number format"

# Weak PIN
PIN: 1111
Expected: "PIN must be stronger"

# Insufficient balance
Amount: 1000.00
Expected: "Insufficient balance"
```

## Privacy and Security Implementation

### Phone Number Privacy

1. **Immediate Hashing**: Phone numbers converted to hashes immediately upon receipt
2. **No Persistence**: Raw phone numbers never stored in variables, logs, or databases
3. **Deterministic Mapping**: Same phone number always generates same account
4. **Salt Protection**: Environment-specific salt prevents rainbow table attacks

### PIN Security

1. **Transmission Only**: PINs only passed to API endpoints for validation
2. **No Local Storage**: PINs never stored in USSD service memory
3. **Strength Validation**: Enforced minimum complexity requirements
4. **Rate Limiting**: Protection against brute force attacks

### Session Security

```typescript
// Session data structure - no sensitive data stored
{
  sessionId: "unique_identifier",
  currentMenu: "balance",
  step: 2,
  data: {
    // Only non-sensitive operational data
    amount: "10.00",
    confirmed: false
  },
  // Phone number only exists during API calls
  timestamp: "2023-07-25T10:30:00Z"
}
```

## Integration with ICP Blockchain

### Canister Interaction

The USSD service integrates with the ICPNomadWallet canister through:

1. **HTTP Gateway**: Backend API serves as HTTP-to-canister bridge
2. **Principal Generation**: Phone number hashes converted to ICP Principals
3. **Gasless Transactions**: ICP's reverse gas model covers all transaction costs
4. **Stablecoin Operations**: Native support for ckUSDC and other stable tokens

### Blockchain Benefits

- **Decentralization**: No central authority controls user funds
- **Transparency**: All transactions verifiable on ICP blockchain
- **Security**: Cryptographic protection of user assets
- **Cost Efficiency**: No transaction fees for end users

## Production Integration

### USSD Gateway Integration

For production deployment, integrate with telecom USSD gateways:

#### 1. Gateway Configuration
```javascript
// Gateway webhook endpoint
app.post('/webhook/ussd', async (req, res) => {
  const { phoneNumber, text, sessionId } = req.body;
  
  const response = await ussdService.handleUSSDRequest(
    phoneNumber,
    text,
    sessionId
  );
  
  res.json({
    text: response.text,
    continueSession: response.continueSession
  });
});
```

#### 2. Provider-Specific Adaptations

Different telecom providers require specific message formats:

```typescript
// Safaricom (Kenya) format
interface SafaricomUSSDRequest {
  sessionId: string;
  msisdn: string;
  text: string;
  serviceCode: string;
}

// Airtel format
interface AirtelUSSDRequest {
  session_id: string;
  phone_number: string;
  input: string;
  service_code: string;
}
```

### Environment Configuration

Production environment variables:

```bash
# Production USSD gateway
USSD_GATEWAY_URL=https://api.safaricom.co.ke/ussd/v1
USSD_GATEWAY_API_KEY=prod_api_key_here
USSD_SERVICE_CODE=*384*96#

# Webhook configuration
USSD_WEBHOOK_URL=https://icpnomad.com/webhook/ussd
USSD_WEBHOOK_SECRET=webhook_validation_secret

# Security settings
PHONE_HASH_SECRET=production_phone_hash_secret
JWT_SECRET=production_jwt_secret

# ICP mainnet configuration
ICP_HOST=https://ic0.app
CANISTER_ID_ICPNOMADWALLET=mainnet_canister_id
```

## Monitoring and Analytics

### Session Monitoring

Track USSD usage without compromising privacy:

```typescript
// Privacy-compliant analytics
interface USSDAnalytics {
  totalSessions: number;
  averageSessionDuration: number;
  menuOptionUsage: Record<string, number>;
  errorRates: Record<string, number>;
  timeOfDayDistribution: Record<string, number>;
  // No phone numbers or personal data
}
```

### Performance Metrics

Monitor system performance:

- **Response Times**: API call latencies
- **Session Success Rates**: Completion percentages
- **Error Frequencies**: Common failure points
- **Concurrent Sessions**: Peak usage patterns

### Health Checks

```bash
# Check USSD service health
curl -X GET http://localhost:3000/health

# Monitor canister health
dfx canister call ICPNomadWallet isHealthy
```

## Troubleshooting

### Common Issues

#### 1. Session Timeouts
```bash
# Check session timeout configuration
echo $USSD_SESSION_TIMEOUT

# Monitor active sessions
curl -X GET http://localhost:3000/ussd/sessions/stats
```

#### 2. Canister Connection Issues
```bash
# Verify canister is running
dfx canister status ICPNomadWallet

# Check network connectivity
dfx ping

# Test canister calls
dfx canister call ICPNomadWallet getBalance '("test_hash")'
```

#### 3. API Integration Problems
```bash
# Test backend endpoints
curl -X POST http://localhost:3000/ussd/balance \
  -H "Content-Type: application/json" \
  -d '{"phoneNumber": "+254700123456", "pin": "1234"}'

# Check backend logs
tail -f logs/icpnomad.log
```

### Debug Mode

Enable verbose logging for troubleshooting:

```bash
# Set debug environment variables
export LOG_LEVEL=debug
export USSD_DEBUG_LOGGING=true
export VERBOSE_LOGGING=true

# Start with debug output
npm run dev
```

## Future Enhancements

### Planned Features

1. **Multi-Language Support**: Internationalization for different regions
2. **Advanced Transactions**: Smart contract interactions
3. **Payment Integration**: Direct mobile money connectivity
4. **Offline Capabilities**: SMS fallback for network issues
5. **Voice Interface**: DTMF-based voice menu system

### Scaling Considerations

1. **Load Balancing**: Multiple USSD service instances
2. **Caching**: Redis for session state management
3. **Monitoring**: Comprehensive logging and alerting
4. **Geographic Distribution**: Regional deployment strategies

## Contributing

### Development Guidelines

1. **Privacy First**: Never store or log phone numbers
2. **Test Coverage**: Comprehensive testing of all USSD flows
3. **Error Handling**: Graceful degradation for all failure modes
4. **Documentation**: Clear documentation for all changes
5. **Security Review**: Security assessment for new features

### Testing Requirements

- Unit tests for all USSD service methods
- Integration tests with mock backend
- End-to-end tests with mock CLI
- Privacy compliance verification
- Performance and load testing

## License

MIT License - see LICENSE file for details.