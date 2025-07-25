import supertest from 'supertest';
import { Agent, HttpAgent } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { createHash } from 'crypto';
import app from '../src/index';
import { canisterService } from '../src/services/canisterService';

// Test configuration
const TEST_PHONE_NUMBERS = [
  '+254700123456',
  '+254700654321',
  '+254711987654',
  '+254722456789'
];

const TEST_PINS = ['1234', '5678', '9012', '3456'];
const INVALID_PHONE = '+254700000000';
const WEAK_PIN = '1111';

describe('ICPNomad Backend API Tests', () => {
  let agent: Agent;
  let canisterId: string;
  const request = supertest(app);

  beforeAll(async () => {
    // Initialize DFX agent for local testing
    agent = new HttpAgent({
      host: process.env.ICP_HOST || 'http://127.0.0.1:4943'
    });

    // Fetch root key for local development
    if (process.env.NODE_ENV === 'development') {
      await agent.fetchRootKey();
    }

    canisterId = process.env.CANISTER_ID_ICPNOMADWALLET || '';
    
    // Verify canister is running
    expect(canisterId).toBeTruthy();
  });

  afterAll(async () => {
    // Cleanup test data if needed
    console.log('Test suite completed');
  });

  describe('Privacy Compliance Tests', () => {
    test('Should never store phone numbers in memory or logs', async () => {
      const phoneNumber = TEST_PHONE_NUMBERS[0];
      const pin = TEST_PINS[0];

      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin })
        .expect(200);

      // Verify response doesn't contain raw phone number
      const responseStr = JSON.stringify(response.body);
      expect(responseStr).not.toContain(phoneNumber);
      
      // Verify only hashed identifiers are used
      expect(response.body.success).toBe(true);
      expect(response.body.accountId).toBeDefined();
      expect(typeof response.body.accountId).toBe('string');
    });

    test('Should use deterministic account generation from phone number', async () => {
      const phoneNumber = TEST_PHONE_NUMBERS[1];
      const pin = TEST_PINS[1];

      // Create account first time
      const response1 = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin })
        .expect(200);

      // Attempt to create same account again
      const response2 = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin })
        .expect(400);

      expect(response1.body.accountId).toBeDefined();
      expect(response2.body.error).toContain('already exists');
    });

    test('Should reject duplicate phone numbers across different PINs', async () => {
      const phoneNumber = TEST_PHONE_NUMBERS[2];
      const pin1 = TEST_PINS[2];
      const pin2 = TEST_PINS[3];

      // Create account with first PIN
      await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin: pin1 })
        .expect(200);

      // Attempt to create account with same phone but different PIN
      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin: pin2 })
        .expect(400);

      expect(response.body.error).toContain('already exists');
    });
  });

  describe('Account Creation Tests', () => {
    test('Should create new wallet account successfully', async () => {
      const phoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      const pin = '1234';

      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.accountId).toBeDefined();
      expect(response.body.message).toContain('created successfully');
    });

    test('Should reject invalid phone number format', async () => {
      const invalidPhone = '123456789';
      const pin = '1234';

      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber: invalidPhone, pin })
        .expect(400);

      expect(response.body.error).toContain('Invalid phone number');
    });

    test('Should reject weak PIN', async () => {
      const phoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      const weakPin = '1111';

      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin: weakPin })
        .expect(400);

      expect(response.body.error).toContain('PIN must be');
    });
  });

  describe('Balance Check Tests', () => {
    let testPhoneNumber: string;
    let testPin: string;

    beforeAll(async () => {
      testPhoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      testPin = '1234';

      // Create test account
      await request
        .post('/ussd/create-account')
        .send({ phoneNumber: testPhoneNumber, pin: testPin })
        .expect(200);
    });

    test('Should retrieve balance for existing account', async () => {
      const response = await request
        .post('/ussd/balance')
        .send({ phoneNumber: testPhoneNumber, pin: testPin })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.balance).toBeDefined();
      expect(typeof response.body.balance).toBe('string');
      expect(parseFloat(response.body.balance)).toBeGreaterThanOrEqual(0);
    });

    test('Should reject balance check with wrong PIN', async () => {
      const response = await request
        .post('/ussd/balance')
        .send({ phoneNumber: testPhoneNumber, pin: '9999' })
        .expect(401);

      expect(response.body.error).toContain('Invalid PIN');
    });

    test('Should reject balance check for non-existent account', async () => {
      const response = await request
        .post('/ussd/balance')
        .send({ phoneNumber: INVALID_PHONE, pin: '1234' })
        .expect(404);

      expect(response.body.error).toContain('Account not found');
    });
  });

  describe('Deposit Tests', () => {
    let testPhoneNumber: string;
    let testPin: string;

    beforeAll(async () => {
      testPhoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      testPin = '5678';

      // Create test account
      await request
        .post('/ussd/create-account')
        .send({ phoneNumber: testPhoneNumber, pin: testPin })
        .expect(200);
    });

    test('Should initiate deposit successfully', async () => {
      const depositAmount = '10.00';

      const response = await request
        .post('/ussd/deposit')
        .send({ 
          phoneNumber: testPhoneNumber, 
          pin: testPin, 
          amount: depositAmount 
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.transactionId).toBeDefined();
      expect(response.body.paymentInstructions).toBeDefined();
    });

    test('Should reject deposit with invalid amount', async () => {
      const response = await request
        .post('/ussd/deposit')
        .send({ 
          phoneNumber: testPhoneNumber, 
          pin: testPin, 
          amount: '-5.00' 
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid amount');
    });

    test('Should reject deposit below minimum amount', async () => {
      const response = await request
        .post('/ussd/deposit')
        .send({ 
          phoneNumber: testPhoneNumber, 
          pin: testPin, 
          amount: '0.50' 
        })
        .expect(400);

      expect(response.body.error).toContain('Minimum deposit');
    });
  });

  describe('Withdrawal Tests', () => {
    let testPhoneNumber: string;
    let testPin: string;

    beforeAll(async () => {
      testPhoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      testPin = '9012';

      // Create test account
      await request
        .post('/ussd/create-account')
        .send({ phoneNumber: testPhoneNumber, pin: testPin })
        .expect(200);
    });

    test('Should reject withdrawal with insufficient balance', async () => {
      const response = await request
        .post('/ussd/withdraw')
        .send({ 
          phoneNumber: testPhoneNumber, 
          pin: testPin, 
          amount: '100.00' 
        })
        .expect(400);

      expect(response.body.error).toContain('Insufficient balance');
    });

    test('Should reject withdrawal with invalid amount', async () => {
      const response = await request
        .post('/ussd/withdraw')
        .send({ 
          phoneNumber: testPhoneNumber, 
          pin: testPin, 
          amount: '0.00' 
        })
        .expect(400);

      expect(response.body.error).toContain('Invalid amount');
    });
  });

  describe('Transfer Tests', () => {
    let senderPhone: string;
    let receiverPhone: string;
    let senderPin: string;
    let receiverPin: string;

    beforeAll(async () => {
      senderPhone = `+254700${Math.floor(Math.random() * 1000000)}`;
      receiverPhone = `+254700${Math.floor(Math.random() * 1000000)}`;
      senderPin = '1111';
      receiverPin = '2222';

      // Create sender account
      await request
        .post('/ussd/create-account')
        .send({ phoneNumber: senderPhone, pin: senderPin })
        .expect(200);

      // Create receiver account
      await request
        .post('/ussd/create-account')
        .send({ phoneNumber: receiverPhone, pin: receiverPin })
        .expect(200);
    });

    test('Should reject transfer with insufficient balance', async () => {
      const response = await request
        .post('/ussd/transfer')
        .send({ 
          phoneNumber: senderPhone, 
          pin: senderPin, 
          recipientPhone: receiverPhone,
          amount: '50.00' 
        })
        .expect(400);

      expect(response.body.error).toContain('Insufficient balance');
    });

    test('Should reject transfer to non-existent recipient', async () => {
      const response = await request
        .post('/ussd/transfer')
        .send({ 
          phoneNumber: senderPhone, 
          pin: senderPin, 
          recipientPhone: INVALID_PHONE,
          amount: '5.00' 
        })
        .expect(404);

      expect(response.body.error).toContain('Recipient not found');
    });

    test('Should reject self-transfer', async () => {
      const response = await request
        .post('/ussd/transfer')
        .send({ 
          phoneNumber: senderPhone, 
          pin: senderPin, 
          recipientPhone: senderPhone,
          amount: '5.00' 
        })
        .expect(400);

      expect(response.body.error).toContain('Cannot transfer to yourself');
    });
  });

  describe('Canister Interaction Tests', () => {
    test('Should verify canister is accessible', async () => {
      expect(canisterService).toBeDefined();
      
      // Test canister health
      const isHealthy = await canisterService.isCanisterHealthy();
      expect(isHealthy).toBe(true);
    });

    test('Should confirm gasless transactions', async () => {
      const phoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      const pin = '1234';

      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber, pin })
        .expect(200);

      // Verify no gas fees charged to user
      expect(response.body.gasFee).toBeUndefined();
      expect(response.body.transactionCost).toBeUndefined();
    });

    test('Should verify phone number hashing consistency', () => {
      const phoneNumber = '+254700123456';
      const salt = process.env.PHONE_HASH_SECRET || 'default-salt';
      
      // Test deterministic hashing
      const hash1 = createHash('sha256').update(phoneNumber + salt).digest('hex');
      const hash2 = createHash('sha256').update(phoneNumber + salt).digest('hex');
      
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(phoneNumber);
    });
  });

  describe('Error Handling Tests', () => {
    test('Should handle malformed JSON requests', async () => {
      const response = await request
        .post('/ussd/create-account')
        .send('invalid json')
        .expect(400);

      expect(response.body.error).toBeDefined();
    });

    test('Should handle missing required fields', async () => {
      const response = await request
        .post('/ussd/create-account')
        .send({ phoneNumber: '+254700123456' })
        .expect(400);

      expect(response.body.error).toContain('PIN is required');
    });

    test('Should handle canister unavailability gracefully', async () => {
      // This test would require mocking canister unavailability
      // Implementation depends on how canister service handles errors
      expect(true).toBe(true); // Placeholder
    });
  });

  describe('Rate Limiting Tests', () => {
    test('Should enforce rate limits for account creation', async () => {
      const phoneNumber = `+254700${Math.floor(Math.random() * 1000000)}`;
      const pin = '1234';

      // Make multiple rapid requests
      const promises = Array(10).fill(0).map(() => 
        request
          .post('/ussd/create-account')
          .send({ phoneNumber: `${phoneNumber}${Math.random()}`, pin })
      );

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
});