import axios, { AxiosResponse } from 'axios';
import { logger } from '@/config/logger';

// USSD session state management
interface USSDSession {
  sessionId: string;
  phoneNumber?: string;
  currentMenu: string;
  step: number;
  data: Record<string, any>;
  timestamp: Date;
  lastActivity: Date;
}

// USSD response structure
interface USSDResponse {
  text: string;
  continueSession: boolean;
  sessionId?: string;
}

// API response interfaces
interface APIResponse {
  success: boolean;
  message?: string;
  error?: string;
  balance?: string;
  currency?: string;
  amount?: string;
  address?: string;
}

// Menu definitions
enum MenuType {
  MAIN = 'main',
  CREATE_ACCOUNT = 'create_account',
  BALANCE = 'balance',
  DEPOSIT = 'deposit',
  WITHDRAW = 'withdraw',
  TRANSFER = 'transfer',
  CONFIRM = 'confirm'
}

class USSDService {
  private sessions: Map<string, USSDSession> = new Map();
  private readonly baseURL: string;
  private readonly sessionTimeout: number;

  constructor() {
    this.baseURL = process.env.API_BASE_URL || 'http://localhost:3000';
    this.sessionTimeout = parseInt(process.env.USSD_SESSION_TIMEOUT || '300000'); // 5 minutes
    
    // Clean up expired sessions every minute
    setInterval(() => this.cleanupExpiredSessions(), 60000);
  }

  /**
   * Main USSD request handler
   */
  async handleUSSDRequest(
    phoneNumber: string, 
    text: string, 
    sessionId: string
  ): Promise<USSDResponse> {
    try {
      logger.info('Processing USSD request', {
        sessionId,
        inputLength: text.length,
        timestamp: new Date().toISOString()
      });

      // Get or create session
      let session = this.getSession(sessionId);
      if (!session) {
        session = this.createSession(sessionId, phoneNumber);
      }

      // Update session activity
      session.lastActivity = new Date();
      session.phoneNumber = phoneNumber;

      // Route based on input
      if (text === '') {
        return this.showMainMenu(session);
      }

      return await this.processMenuInput(session, text);

    } catch (error: any) {
      logger.error('Error processing USSD request:', {
        sessionId,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      return {
        text: 'Service temporarily unavailable. Please try again later.',
        continueSession: false
      };
    }
  }

  /**
   * Create new USSD session
   */
  private createSession(sessionId: string, phoneNumber: string): USSDSession {
    const session: USSDSession = {
      sessionId,
      phoneNumber,
      currentMenu: MenuType.MAIN,
      step: 0,
      data: {},
      timestamp: new Date(),
      lastActivity: new Date()
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Get existing session
   */
  private getSession(sessionId: string): USSDSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;

    // Check if session expired
    const now = new Date().getTime();
    const lastActivity = session.lastActivity.getTime();
    if (now - lastActivity > this.sessionTimeout) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  /**
   * Show main menu
   */
  private showMainMenu(session: USSDSession): USSDResponse {
    session.currentMenu = MenuType.MAIN;
    session.step = 0;
    session.data = {};

    const menuText = `Welcome to ICPNomad Wallet\n\n` +
      `1. Create Account\n` +
      `2. Check Balance\n` +
      `3. Deposit Funds\n` +
      `4. Withdraw Funds\n` +
      `5. Transfer Funds\n\n` +
      `Select an option:`;

    return {
      text: menuText,
      continueSession: true,
      sessionId: session.sessionId
    };
  }

  /**
   * Process menu input based on current state
   */
  private async processMenuInput(session: USSDSession, input: string): Promise<USSDResponse> {
    const trimmedInput = input.trim();

    // Handle main menu selection
    if (session.currentMenu === MenuType.MAIN && session.step === 0) {
      return this.handleMainMenuSelection(session, trimmedInput);
    }

    // Handle sub-menu flows
    switch (session.currentMenu) {
      case MenuType.CREATE_ACCOUNT:
        return await this.handleCreateAccountFlow(session, trimmedInput);
      case MenuType.BALANCE:
        return await this.handleBalanceFlow(session, trimmedInput);
      case MenuType.DEPOSIT:
        return await this.handleDepositFlow(session, trimmedInput);
      case MenuType.WITHDRAW:
        return await this.handleWithdrawFlow(session, trimmedInput);
      case MenuType.TRANSFER:
        return await this.handleTransferFlow(session, trimmedInput);
      case MenuType.CONFIRM:
        return await this.handleConfirmationFlow(session, trimmedInput);
      default:
        return this.showMainMenu(session);
    }
  }

  /**
   * Handle main menu selection
   */
  private handleMainMenuSelection(session: USSDSession, input: string): USSDResponse {
    switch (input) {
      case '1':
        session.currentMenu = MenuType.CREATE_ACCOUNT;
        session.step = 1;
        return {
          text: 'Create New Account\n\nEnter your 4-digit PIN:',
          continueSession: true
        };

      case '2':
        session.currentMenu = MenuType.BALANCE;
        session.step = 1;
        return {
          text: 'Check Balance\n\nEnter your 4-digit PIN:',
          continueSession: true
        };

      case '3':
        session.currentMenu = MenuType.DEPOSIT;
        session.step = 1;
        return {
          text: 'Deposit Funds\n\nEnter your 4-digit PIN:',
          continueSession: true
        };

      case '4':
        session.currentMenu = MenuType.WITHDRAW;
        session.step = 1;
        return {
          text: 'Withdraw Funds\n\nEnter your 4-digit PIN:',
          continueSession: true
        };

      case '5':
        session.currentMenu = MenuType.TRANSFER;
        session.step = 1;
        return {
          text: 'Transfer Funds\n\nEnter your 4-digit PIN:',
          continueSession: true
        };

      default:
        return {
          text: 'Invalid selection. Please choose 1-5.',
          continueSession: false
        };
    }
  }

  /**
   * Handle account creation flow
   */
  private async handleCreateAccountFlow(session: USSDSession, input: string): Promise<USSDResponse> {
    if (session.step === 1) {
      // Validate PIN
      if (!this.isValidPIN(input)) {
        return {
          text: 'Invalid PIN. Please enter a 4-digit PIN (no repeated digits):',
          continueSession: true
        };
      }

      session.data.pin = input;
      session.step = 2;
      return {
        text: 'Confirm your PIN:',
        continueSession: true
      };
    }

    if (session.step === 2) {
      // Confirm PIN
      if (input !== session.data.pin) {
        session.step = 1;
        return {
          text: 'PINs do not match. Enter your 4-digit PIN:',
          continueSession: true
        };
      }

      // Create account via API
      try {
        const response = await this.callAPI('/ussd/create-account', {
          phoneNumber: session.phoneNumber,
          pin: session.data.pin
        });

        if (response.success) {
          return {
            text: `Account created successfully!\n\nYour wallet is ready for use.\n\nPress any key to return to main menu.`,
            continueSession: false
          };
        } else {
          return {
            text: `Account creation failed: ${response.error}\n\nPress any key to try again.`,
            continueSession: false
          };
        }
      } catch (error: any) {
        logger.error('API call failed for create account:', error.message);
        return {
          text: 'Service unavailable. Please try again later.',
          continueSession: false
        };
      }
    }

    return this.showMainMenu(session);
  }

  /**
   * Handle balance check flow
   */
  private async handleBalanceFlow(session: USSDSession, input: string): Promise<USSDResponse> {
    if (session.step === 1) {
      // Validate PIN
      if (!this.isValidPIN(input)) {
        return {
          text: 'Invalid PIN format. Enter your 4-digit PIN:',
          continueSession: true
        };
      }

      // Check balance via API
      try {
        const response = await this.callAPI('/ussd/balance', {
          phoneNumber: session.phoneNumber,
          pin: input
        });

        if (response.success) {
          const balance = parseFloat(response.balance || '0').toFixed(2);
          return {
            text: `Your Balance\n\n${balance} ${response.currency || 'STABLECOIN'}\n\nPress any key to return to main menu.`,
            continueSession: false
          };
        } else {
          return {
            text: `Balance check failed: ${response.error}\n\nPress any key to try again.`,
            continueSession: false
          };
        }
      } catch (error: any) {
        logger.error('API call failed for balance check:', error.message);
        return {
          text: 'Service unavailable. Please try again later.',
          continueSession: false
        };
      }
    }

    return this.showMainMenu(session);
  }

  /**
   * Handle deposit flow
   */
  private async handleDepositFlow(session: USSDSession, input: string): Promise<USSDResponse> {
    if (session.step === 1) {
      // Validate PIN
      if (!this.isValidPIN(input)) {
        return {
          text: 'Invalid PIN format. Enter your 4-digit PIN:',
          continueSession: true
        };
      }

      session.data.pin = input;
      session.step = 2;
      return {
        text: 'Enter deposit amount (minimum 1.00):',
        continueSession: true
      };
    }

    if (session.step === 2) {
      // Validate amount
      const amount = parseFloat(input);
      if (isNaN(amount) || amount < 1.00 || amount > 10000.00) {
        return {
          text: 'Invalid amount. Enter amount between 1.00 and 10,000.00:',
          continueSession: true
        };
      }

      session.data.amount = amount;
      session.currentMenu = MenuType.CONFIRM;
      session.step = 1;
      return {
        text: `Confirm Deposit\n\nAmount: ${amount.toFixed(2)} STABLECOIN\n\n1. Confirm\n2. Cancel`,
        continueSession: true
      };
    }

    return this.showMainMenu(session);
  }

  /**
   * Handle withdraw flow
   */
  private async handleWithdrawFlow(session: USSDSession, input: string): Promise<USSDResponse> {
    if (session.step === 1) {
      // Validate PIN
      if (!this.isValidPIN(input)) {
        return {
          text: 'Invalid PIN format. Enter your 4-digit PIN:',
          continueSession: true
        };
      }

      session.data.pin = input;
      session.step = 2;
      return {
        text: 'Enter withdrawal amount (minimum 1.00):',
        continueSession: true
      };
    }

    if (session.step === 2) {
      // Validate amount
      const amount = parseFloat(input);
      if (isNaN(amount) || amount < 1.00 || amount > 5000.00) {
        return {
          text: 'Invalid amount. Enter amount between 1.00 and 5,000.00:',
          continueSession: true
        };
      }

      session.data.amount = amount;
      session.currentMenu = MenuType.CONFIRM;
      session.step = 1;
      return {
        text: `Confirm Withdrawal\n\nAmount: ${amount.toFixed(2)} STABLECOIN\n\n1. Confirm\n2. Cancel`,
        continueSession: true
      };
    }

    return this.showMainMenu(session);
  }

  /**
   * Handle transfer flow
   */
  private async handleTransferFlow(session: USSDSession, input: string): Promise<USSDResponse> {
    if (session.step === 1) {
      // Validate PIN
      if (!this.isValidPIN(input)) {
        return {
          text: 'Invalid PIN format. Enter your 4-digit PIN:',
          continueSession: true
        };
      }

      session.data.pin = input;
      session.step = 2;
      return {
        text: 'Enter recipient phone number (with country code):',
        continueSession: true
      };
    }

    if (session.step === 2) {
      // Validate phone number
      if (!this.isValidPhoneNumber(input)) {
        return {
          text: 'Invalid phone number. Enter with country code (e.g., +254700123456):',
          continueSession: true
        };
      }

      if (input === session.phoneNumber) {
        return {
          text: 'Cannot transfer to yourself. Enter different phone number:',
          continueSession: true
        };
      }

      session.data.recipientPhone = input;
      session.step = 3;
      return {
        text: 'Enter transfer amount (minimum 1.00):',
        continueSession: true
      };
    }

    if (session.step === 3) {
      // Validate amount
      const amount = parseFloat(input);
      if (isNaN(amount) || amount < 1.00 || amount > 5000.00) {
        return {
          text: 'Invalid amount. Enter amount between 1.00 and 5,000.00:',
          continueSession: true
        };
      }

      session.data.amount = amount;
      session.currentMenu = MenuType.CONFIRM;
      session.step = 1;
      
      const maskedPhone = this.maskPhoneNumber(session.data.recipientPhone);
      return {
        text: `Confirm Transfer\n\nTo: ${maskedPhone}\nAmount: ${amount.toFixed(2)} STABLECOIN\n\n1. Confirm\n2. Cancel`,
        continueSession: true
      };
    }

    return this.showMainMenu(session);
  }

  /**
   * Handle confirmation flow
   */
  private async handleConfirmationFlow(session: USSDSession, input: string): Promise<USSDResponse> {
    if (input === '1') {
      // Execute the transaction
      try {
        let endpoint = '';
        let payload: any = {
          phoneNumber: session.phoneNumber,
          pin: session.data.pin
        };

        // Determine endpoint and payload based on previous menu
        if (session.data.amount) {
          payload.amount = session.data.amount;
        }

        switch (session.currentMenu) {
          case MenuType.CONFIRM:
            // Check which operation we're confirming
            if (session.data.recipientPhone) {
              endpoint = '/ussd/transfer';
              payload.recipientPhoneNumber = session.data.recipientPhone;
            } else {
              // Check if it's deposit or withdraw based on previous flow
              const lastMenu = this.getPreviousMenu(session);
              endpoint = lastMenu === MenuType.DEPOSIT ? '/ussd/deposit' : '/ussd/withdraw';
            }
            break;
          default:
            return this.showMainMenu(session);
        }

        const response = await this.callAPI(endpoint, payload);

        if (response.success) {
          const operationType = endpoint.split('/').pop()?.replace('-', ' ') || 'operation';
          return {
            text: `${operationType.charAt(0).toUpperCase() + operationType.slice(1)} successful!\n\nPress any key to return to main menu.`,
            continueSession: false
          };
        } else {
          return {
            text: `Transaction failed: ${response.error}\n\nPress any key to try again.`,
            continueSession: false
          };
        }
      } catch (error: any) {
        logger.error('API call failed for transaction:', error.message);
        return {
          text: 'Service unavailable. Please try again later.',
          continueSession: false
        };
      }
    } else if (input === '2') {
      // Cancel transaction
      return this.showMainMenu(session);
    } else {
      return {
        text: 'Invalid option. Press 1 to confirm or 2 to cancel:',
        continueSession: true
      };
    }
  }

  /**
   * Make HTTP API call to backend
   */
  private async callAPI(endpoint: string, data: any): Promise<APIResponse> {
    try {
      const response: AxiosResponse<APIResponse> = await axios.post(
        `${this.baseURL}${endpoint}`,
        data,
        {
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'ICPNomad-USSD/1.0'
          },
          timeout: 30000 // 30 second timeout
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('API request failed:', {
        endpoint,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      if (error.response?.data) {
        return error.response.data;
      }

      throw new Error(`API call failed: ${error.message}`);
    }
  }

  /**
   * Validate PIN format
   */
  private isValidPIN(pin: string): boolean {
    // Must be 4 digits
    if (!/^\d{4}$/.test(pin)) {
      return false;
    }

    // No repeated digits (weak PIN check)
    const digits = pin.split('');
    if (new Set(digits).size < 3) {
      return false;
    }

    // No sequential patterns
    const sequential = ['0123', '1234', '2345', '3456', '4567', '5678', '6789'];
    const reverseSequential = sequential.map(s => s.split('').reverse().join(''));
    if (sequential.includes(pin) || reverseSequential.includes(pin)) {
      return false;
    }

    return true;
  }

  /**
   * Validate phone number format (E.164)
   */
  private isValidPhoneNumber(phone: string): boolean {
    return /^\+[1-9]\d{1,14}$/.test(phone);
  }

  /**
   * Mask phone number for display
   */
  private maskPhoneNumber(phone: string): string {
    if (phone.length < 8) return phone;
    const country = phone.substring(0, 4);
    const masked = '*'.repeat(phone.length - 7);
    const last = phone.substring(phone.length - 3);
    return `${country}${masked}${last}`;
  }

  /**
   * Get previous menu type from session data
   */
  private getPreviousMenu(session: USSDSession): MenuType {
    // This is a simplified approach - in a real implementation,
    // you might want to maintain a menu history stack
    if (session.data.recipientPhone) {
      return MenuType.TRANSFER;
    }
    // Default assumption based on typical flow
    return MenuType.DEPOSIT;
  }

  /**
   * Clean up expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = new Date().getTime();
    const expiredSessions: string[] = [];

    this.sessions.forEach((session, sessionId) => {
      const lastActivity = session.lastActivity.getTime();
      if (now - lastActivity > this.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    });

    expiredSessions.forEach(sessionId => {
      this.sessions.delete(sessionId);
      logger.info('Cleaned up expired USSD session', { sessionId });
    });

    if (expiredSessions.length > 0) {
      logger.info(`Cleaned up ${expiredSessions.length} expired USSD sessions`);
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): { activeSessions: number; totalSessions: number } {
    return {
      activeSessions: this.sessions.size,
      totalSessions: this.sessions.size // In a real implementation, track total separately
    };
  }

  /**
   * End session manually
   */
  endSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    logger.info('USSD session ended manually', { sessionId });
  }
}

// Export singleton instance
export const ussdService = new USSDService();
export default ussdService;