import { Router, Request, Response } from 'express';
import { logger } from '@/config/logger';
import { canisterService } from '@/services/canisterService';
import Joi from 'joi';

const router = Router();

// Validation schemas
const phoneSchema = Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required();
const pinSchema = Joi.string().length(4).pattern(/^\d+$/).required();
const amountSchema = Joi.number().positive().precision(6).required();

const createAccountSchema = Joi.object({
  phoneNumber: phoneSchema,
  pin: pinSchema
});

const balanceSchema = Joi.object({
  phoneNumber: phoneSchema,
  pin: pinSchema
});

const depositSchema = Joi.object({
  phoneNumber: phoneSchema,
  pin: pinSchema,
  amount: amountSchema
});

const withdrawSchema = Joi.object({
  phoneNumber: phoneSchema,
  pin: pinSchema,
  amount: amountSchema
});

const transferSchema = Joi.object({
  phoneNumber: phoneSchema,
  pin: pinSchema,
  recipientPhoneNumber: phoneSchema,
  amount: amountSchema
});

// Validation middleware
const validateRequest = (schema: Joi.ObjectSchema) => {
  return (req: Request, res: Response, next: any) => {
    const { error } = schema.validate(req.body);
    if (error) {
      logger.warn('Validation error:', {
        error: error.details[0].message,
        path: req.path,
        timestamp: new Date().toISOString()
      });
      return res.status(400).json({
        error: 'Validation failed',
        message: error.details[0].message
      });
    }
    next();
  };
};

// POST /ussd/create-account
router.post('/create-account', validateRequest(createAccountSchema), async (req: Request, res: Response) => {
  try {
    const { phoneNumber, pin } = req.body;
    
    logger.info('Creating wallet account', {
      endpoint: '/ussd/create-account',
      timestamp: new Date().toISOString()
    });

    const result = await canisterService.generateWallet(phoneNumber, pin);
    
    if ('ok' in result) {
      logger.info('Wallet created successfully', {
        endpoint: '/ussd/create-account',
        timestamp: new Date().toISOString()
      });
      
      res.status(201).json({
        success: true,
        message: 'Account created successfully',
        address: result.ok.toString()
      });
    } else {
      logger.warn('Wallet creation failed', {
        endpoint: '/ussd/create-account',
        error: Object.keys(result.err)[0],
        timestamp: new Date().toISOString()
      });
      
      res.status(400).json({
        success: false,
        error: Object.keys(result.err)[0]
      });
    }
  } catch (error: any) {
    logger.error('Error creating wallet:', {
      endpoint: '/ussd/create-account',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /ussd/balance
router.post('/balance', validateRequest(balanceSchema), async (req: Request, res: Response) => {
  try {
    const { phoneNumber, pin } = req.body;
    
    logger.info('Retrieving balance', {
      endpoint: '/ussd/balance',
      timestamp: new Date().toISOString()
    });

    const result = await canisterService.getStablecoinBalance(phoneNumber, pin);
    
    if ('ok' in result) {
      logger.info('Balance retrieved successfully', {
        endpoint: '/ussd/balance',
        timestamp: new Date().toISOString()
      });
      
      res.status(200).json({
        success: true,
        balance: result.ok.toString(),
        currency: 'STABLECOIN'
      });
    } else {
      logger.warn('Balance retrieval failed', {
        endpoint: '/ussd/balance',
        error: Object.keys(result.err)[0],
        timestamp: new Date().toISOString()
      });
      
      res.status(400).json({
        success: false,
        error: Object.keys(result.err)[0]
      });
    }
  } catch (error: any) {
    logger.error('Error retrieving balance:', {
      endpoint: '/ussd/balance',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /ussd/deposit
router.post('/deposit', validateRequest(depositSchema), async (req: Request, res: Response) => {
  try {
    const { phoneNumber, pin, amount } = req.body;
    
    // Convert amount to smallest unit (assuming 6 decimals for stablecoin)
    const amountInSmallestUnit = Math.floor(amount * 1_000_000);
    
    logger.info('Processing deposit', {
      endpoint: '/ussd/deposit',
      amount: amountInSmallestUnit,
      timestamp: new Date().toISOString()
    });

    const result = await canisterService.depositStablecoin(phoneNumber, pin, amountInSmallestUnit);
    
    if ('ok' in result) {
      logger.info('Deposit successful', {
        endpoint: '/ussd/deposit',
        amount: amountInSmallestUnit,
        timestamp: new Date().toISOString()
      });
      
      res.status(200).json({
        success: true,
        message: 'Deposit successful',
        amount: amount,
        currency: 'STABLECOIN'
      });
    } else {
      logger.warn('Deposit failed', {
        endpoint: '/ussd/deposit',
        error: Object.keys(result.err)[0],
        timestamp: new Date().toISOString()
      });
      
      res.status(400).json({
        success: false,
        error: Object.keys(result.err)[0]
      });
    }
  } catch (error: any) {
    logger.error('Error processing deposit:', {
      endpoint: '/ussd/deposit',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /ussd/withdraw
router.post('/withdraw', validateRequest(withdrawSchema), async (req: Request, res: Response) => {
  try {
    const { phoneNumber, pin, amount } = req.body;
    
    // Convert amount to smallest unit (assuming 6 decimals for stablecoin)
    const amountInSmallestUnit = Math.floor(amount * 1_000_000);
    
    logger.info('Processing withdrawal', {
      endpoint: '/ussd/withdraw',
      amount: amountInSmallestUnit,
      timestamp: new Date().toISOString()
    });

    const result = await canisterService.withdrawStablecoin(phoneNumber, pin, amountInSmallestUnit);
    
    if ('ok' in result) {
      logger.info('Withdrawal successful', {
        endpoint: '/ussd/withdraw',
        amount: amountInSmallestUnit,
        timestamp: new Date().toISOString()
      });
      
      res.status(200).json({
        success: true,
        message: 'Withdrawal successful',
        amount: amount,
        currency: 'STABLECOIN'
      });
    } else {
      logger.warn('Withdrawal failed', {
        endpoint: '/ussd/withdraw',
        error: Object.keys(result.err)[0],
        timestamp: new Date().toISOString()
      });
      
      res.status(400).json({
        success: false,
        error: Object.keys(result.err)[0]
      });
    }
  } catch (error: any) {
    logger.error('Error processing withdrawal:', {
      endpoint: '/ussd/withdraw',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

// POST /ussd/transfer
router.post('/transfer', validateRequest(transferSchema), async (req: Request, res: Response) => {
  try {
    const { phoneNumber, pin, recipientPhoneNumber, amount } = req.body;
    
    // Convert amount to smallest unit (assuming 6 decimals for stablecoin)
    const amountInSmallestUnit = Math.floor(amount * 1_000_000);
    
    logger.info('Processing transfer', {
      endpoint: '/ussd/transfer',
      amount: amountInSmallestUnit,
      timestamp: new Date().toISOString()
    });

    const result = await canisterService.transferStablecoin(phoneNumber, pin, recipientPhoneNumber, amountInSmallestUnit);
    
    if ('ok' in result) {
      logger.info('Transfer successful', {
        endpoint: '/ussd/transfer',
        amount: amountInSmallestUnit,
        timestamp: new Date().toISOString()
      });
      
      res.status(200).json({
        success: true,
        message: 'Transfer successful',
        amount: amount,
        currency: 'STABLECOIN'
      });
    } else {
      logger.warn('Transfer failed', {
        endpoint: '/ussd/transfer',
        error: Object.keys(result.err)[0],
        timestamp: new Date().toISOString()
      });
      
      res.status(400).json({
        success: false,
        error: Object.keys(result.err)[0]
      });
    }
  } catch (error: any) {
    logger.error('Error processing transfer:', {
      endpoint: '/ussd/transfer',
      error: error.message,
      timestamp: new Date().toISOString()
    });
    
    res.status(500).json({
      success: false,
      error: 'Internal server error'
    });
  }
});

export default router;