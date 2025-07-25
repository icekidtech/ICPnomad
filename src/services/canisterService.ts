import { Actor, HttpAgent, Identity } from '@dfinity/agent';
import { Principal } from '@dfinity/principal';
import { logger } from '@/config/logger';

// Define the canister interface based on the Motoko implementation
interface ICPNomadWallet {
  generateWallet: (phoneNumber: string, pin: string) => Promise<Result<Principal, WalletError>>;
  getStablecoinBalance: (phoneNumber: string, pin: string) => Promise<Result<bigint, WalletError>>;
  depositStablecoin: (phoneNumber: string, pin: string, amount: bigint) => Promise<Result<null, WalletError>>;
  withdrawStablecoin: (phoneNumber: string, pin: string, amount: bigint) => Promise<Result<null, WalletError>>;
  transferStablecoin: (phoneNumber: string, pin: string, recipientPhoneNumber: string, amount: bigint) => Promise<Result<null, WalletError>>;
  walletExists: (phoneNumber: string, pin: string) => Promise<boolean>;
  healthCheck: () => Promise<{ status: string; timestamp: bigint }>;
}

type Result<T, E> = { ok: T } | { err: E };

interface WalletError {
  invalidCredentials?: null;
  walletNotFound?: null;
  insufficientFunds?: null;
  addressAlreadyExists?: null;
  invalidAmount?: null;
  transactionFailed?: null;
  systemError?: null;
}

// IDL factory for the canister interface
const idlFactory = ({ IDL }: any) => {
  const WalletError = IDL.Variant({
    'invalidCredentials': IDL.Null,
    'walletNotFound': IDL.Null,
    'insufficientFunds': IDL.Null,
    'addressAlreadyExists': IDL.Null,
    'invalidAmount': IDL.Null,
    'transactionFailed': IDL.Null,
    'systemError': IDL.Null,
  });

  const Result = (T: any, E: any) => IDL.Variant({ 'ok': T, 'err': E });
  const Result_1 = Result(IDL.Principal, WalletError);
  const Result_2 = Result(IDL.Nat, WalletError);
  const Result_3 = Result(IDL.Null, WalletError);

  return IDL.Service({
    'generateWallet': IDL.Func([IDL.Text, IDL.Text], [Result_1], []),
    'getStablecoinBalance': IDL.Func([IDL.Text, IDL.Text], [Result_2], ['query']),
    'depositStablecoin': IDL.Func([IDL.Text, IDL.Text, IDL.Nat], [Result_3], []),
    'withdrawStablecoin': IDL.Func([IDL.Text, IDL.Text, IDL.Nat], [Result_3], []),
    'transferStablecoin': IDL.Func([IDL.Text, IDL.Text, IDL.Text, IDL.Nat], [Result_3], []),
    'walletExists': IDL.Func([IDL.Text, IDL.Text], [IDL.Bool], ['query']),
    'healthCheck': IDL.Func([], [IDL.Record({ 'status': IDL.Text, 'timestamp': IDL.Nat64 })], ['query']),
  });
};

class CanisterService {
  private actor: ICPNomadWallet | null = null;
  private agent: HttpAgent | null = null;
  private readonly canisterId: string;
  private readonly host: string;

  constructor() {
    this.canisterId = process.env.CANISTER_ID_ICPNOMAD_WALLET || '';
    this.host = process.env.ICP_HOST || 'http://127.0.0.1:4943';

    if (!this.canisterId) {
      throw new Error('CANISTER_ID_ICPNOMAD_WALLET environment variable is required');
    }

    this.initializeAgent();
  }

  private async initializeAgent(): Promise<void> {
    try {
      this.agent = new HttpAgent({
        host: this.host,
      });

      // Fetch root key for local development
      if (this.host.includes('localhost') || this.host.includes('127.0.0.1')) {
        await this.agent.fetchRootKey();
        logger.info('Fetched root key for local development');
      }

      this.actor = Actor.createActor<ICPNomadWallet>(idlFactory, {
        agent: this.agent,
        canisterId: this.canisterId,
      });

      logger.info('Canister service initialized', {
        canisterId: this.canisterId,
        host: this.host,
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      logger.error('Failed to initialize canister service:', {
        error: error.message,
        canisterId: this.canisterId,
        host: this.host,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  private ensureActorInitialized(): void {
    if (!this.actor) {
      throw new Error('Canister service not initialized');
    }
  }

  async generateWallet(phoneNumber: string, pin: string): Promise<Result<Principal, WalletError>> {
    this.ensureActorInitialized();
    
    try {
      logger.info('Calling generateWallet canister method', {
        method: 'generateWallet',
        timestamp: new Date().toISOString()
      });

      const result = await this.actor!.generateWallet(phoneNumber, pin);
      
      logger.info('generateWallet canister call completed', {
        method: 'generateWallet',
        success: 'ok' in result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error: any) {
      logger.error('generateWallet canister call failed:', {
        method: 'generateWallet',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async getStablecoinBalance(phoneNumber: string, pin: string): Promise<Result<bigint, WalletError>> {
    this.ensureActorInitialized();
    
    try {
      logger.info('Calling getStablecoinBalance canister method', {
        method: 'getStablecoinBalance',
        timestamp: new Date().toISOString()
      });

      const result = await this.actor!.getStablecoinBalance(phoneNumber, pin);
      
      logger.info('getStablecoinBalance canister call completed', {
        method: 'getStablecoinBalance',
        success: 'ok' in result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error: any) {
      logger.error('getStablecoinBalance canister call failed:', {
        method: 'getStablecoinBalance',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async depositStablecoin(phoneNumber: string, pin: string, amount: number): Promise<Result<null, WalletError>> {
    this.ensureActorInitialized();
    
    try {
      logger.info('Calling depositStablecoin canister method', {
        method: 'depositStablecoin',
        amount,
        timestamp: new Date().toISOString()
      });

      const result = await this.actor!.depositStablecoin(phoneNumber, pin, BigInt(amount));
      
      logger.info('depositStablecoin canister call completed', {
        method: 'depositStablecoin',
        amount,
        success: 'ok' in result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error: any) {
      logger.error('depositStablecoin canister call failed:', {
        method: 'depositStablecoin',
        amount,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async withdrawStablecoin(phoneNumber: string, pin: string, amount: number): Promise<Result<null, WalletError>> {
    this.ensureActorInitialized();
    
    try {
      logger.info('Calling withdrawStablecoin canister method', {
        method: 'withdrawStablecoin',
        amount,
        timestamp: new Date().toISOString()
      });

      const result = await this.actor!.withdrawStablecoin(phoneNumber, pin, BigInt(amount));
      
      logger.info('withdrawStablecoin canister call completed', {
        method: 'withdrawStablecoin',
        amount,
        success: 'ok' in result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error: any) {
      logger.error('withdrawStablecoin canister call failed:', {
        method: 'withdrawStablecoin',
        amount,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async transferStablecoin(
    phoneNumber: string, 
    pin: string, 
    recipientPhoneNumber: string, 
    amount: number
  ): Promise<Result<null, WalletError>> {
    this.ensureActorInitialized();
    
    try {
      logger.info('Calling transferStablecoin canister method', {
        method: 'transferStablecoin',
        amount,
        timestamp: new Date().toISOString()
      });

      const result = await this.actor!.transferStablecoin(phoneNumber, pin, recipientPhoneNumber, BigInt(amount));
      
      logger.info('transferStablecoin canister call completed', {
        method: 'transferStablecoin',
        amount,
        success: 'ok' in result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error: any) {
      logger.error('transferStablecoin canister call failed:', {
        method: 'transferStablecoin',
        amount,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async walletExists(phoneNumber: string, pin: string): Promise<boolean> {
    this.ensureActorInitialized();
    
    try {
      logger.info('Calling walletExists canister method', {
        method: 'walletExists',
        timestamp: new Date().toISOString()
      });

      const result = await this.actor!.walletExists(phoneNumber, pin);
      
      logger.info('walletExists canister call completed', {
        method: 'walletExists',
        exists: result,
        timestamp: new Date().toISOString()
      });

      return result;
    } catch (error: any) {
      logger.error('walletExists canister call failed:', {
        method: 'walletExists',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  async healthCheck(): Promise<{ status: string; timestamp: bigint }> {
    this.ensureActorInitialized();
    
    try {
      const result = await this.actor!.healthCheck();
      logger.info('Canister health check successful', {
        method: 'healthCheck',
        status: result.status,
        timestamp: new Date().toISOString()
      });
      return result;
    } catch (error: any) {
      logger.error('Canister health check failed:', {
        method: 'healthCheck',
        error: error.message,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }
}

// Export singleton instance
export const canisterService = new CanisterService();