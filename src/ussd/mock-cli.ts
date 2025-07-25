import readline from 'readline';
import chalk from 'chalk';
import figlet from 'figlet';
import { ussdService } from './ussdService';

// Mock USSD session interface
interface MockUSSDSession {
  sessionId: string;
  phoneNumber: string;
  isActive: boolean;
  startTime: Date;
}

class MockUSSDCLI {
  private rl: readline.Interface;
  private currentSession: MockUSSDSession | null = null;
  private sessionCounter = 0;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('USSD> ')
    });

    this.setupEventHandlers();
  }

  /**
   * Initialize the mock USSD CLI
   */
  async start(): Promise<void> {
    console.clear();
    
    // Display ASCII art banner
    try {
      const banner = figlet.textSync('ICPNomad', {
        font: 'Standard',
        horizontalLayout: 'default',
        verticalLayout: 'default'
      });
      console.log(chalk.blue(banner));
    } catch (error) {
      console.log(chalk.blue('=== ICPNomad USSD Mock CLI ==='));
    }

    console.log(chalk.yellow('\n🔐 Blockchain Wallet for Feature Phones'));
    console.log(chalk.gray('Simulating USSD interface for testing\n'));
    
    this.showInstructions();
    this.promptForAction();
  }

  /**
   * Display CLI instructions
   */
  private showInstructions(): void {
    console.log(chalk.green('📱 Instructions:'));
    console.log('  • Type a phone number to start a USSD session (e.g., +254700123456)');
    console.log('  • Use commands: help, quit, clear, sessions');
    console.log('  • Follow USSD prompts during active sessions');
    console.log('  • Phone numbers and PINs are never stored\n');
  }

  /**
   * Setup readline event handlers
   */
  private setupEventHandlers(): void {
    this.rl.on('line', async (input: string) => {
      const trimmedInput = input.trim();
      
      if (trimmedInput === '') {
        this.promptForAction();
        return;
      }

      await this.handleInput(trimmedInput);
    });

    this.rl.on('close', () => {
      console.log(chalk.yellow('\n👋 Goodbye! Thanks for testing ICPNomad USSD.'));
      process.exit(0);
    });

    // Handle Ctrl+C gracefully
    process.on('SIGINT', () => {
      console.log(chalk.yellow('\n\n🛑 Session interrupted.'));
      if (this.currentSession) {
        console.log(chalk.gray(`Ending session ${this.currentSession.sessionId}`));
        this.endCurrentSession();
      }
      this.rl.close();
    });
  }

  /**
   * Handle user input
   */
  private async handleInput(input: string): Promise<void> {
    try {
      // Handle commands
      if (this.isCommand(input)) {
        await this.handleCommand(input);
        return;
      }

      // Handle USSD session
      if (this.currentSession) {
        await this.handleUSSDInput(input);
      } else {
        await this.handleNewSession(input);
      }
    } catch (error: any) {
      console.log(chalk.red(`❌ Error: ${error.message}`));
      this.promptForAction();
    }
  }

  /**
   * Check if input is a command
   */
  private isCommand(input: string): boolean {
    const commands = ['help', 'quit', 'exit', 'clear', 'sessions', 'end'];
    return commands.includes(input.toLowerCase());
  }

  /**
   * Handle CLI commands
   */
  private async handleCommand(command: string): Promise<void> {
    switch (command.toLowerCase()) {
      case 'help':
        this.showHelp();
        break;
      
      case 'quit':
      case 'exit':
        this.rl.close();
        break;
      
      case 'clear':
        console.clear();
        console.log(chalk.blue('=== ICPNomad USSD Mock CLI ===\n'));
        break;
      
      case 'sessions':
        this.showSessionInfo();
        break;
      
      case 'end':
        if (this.currentSession) {
          this.endCurrentSession();
        } else {
          console.log(chalk.yellow('ℹ️  No active session to end.'));
        }
        break;
      
      default:
        console.log(chalk.red('❌ Unknown command. Type "help" for available commands.'));
    }
    
    this.promptForAction();
  }

  /**
   * Show help information
   */
  private showHelp(): void {
    console.log(chalk.green('\n📖 Available Commands:'));
    console.log('  help       - Show this help message');
    console.log('  quit/exit  - Exit the CLI');
    console.log('  clear      - Clear the screen');
    console.log('  sessions   - Show session information');
    console.log('  end        - End current USSD session');
    console.log('\n📱 USSD Testing:');
    console.log('  Enter phone number (e.g., +254700123456) to start session');
    console.log('  Follow menu prompts (1-5 for main menu options)');
    console.log('  Enter 4-digit PINs when prompted');
    console.log('  Enter amounts as decimal numbers (e.g., 10.50)');
    console.log('\n🔐 Privacy Features:');
    console.log('  • Phone numbers are never stored in memory');
    console.log('  • PINs are only passed to API endpoints');
    console.log('  • Sessions automatically expire after timeout');
    console.log();
  }

  /**
   * Show session information
   */
  private showSessionInfo(): void {
    const stats = ussdService.getSessionStats();
    
    console.log(chalk.blue('\n📊 Session Information:'));
    console.log(`  Active sessions: ${stats.activeSessions}`);
    console.log(`  Total sessions: ${stats.totalSessions}`);
    
    if (this.currentSession) {
      const duration = Date.now() - this.currentSession.startTime.getTime();
      const durationMinutes = Math.floor(duration / 60000);
      const durationSeconds = Math.floor((duration % 60000) / 1000);
      
      console.log(chalk.green('\n🔄 Current Session:'));
      console.log(`  Session ID: ${this.currentSession.sessionId}`);
      console.log(`  Phone: ${this.maskPhoneNumber(this.currentSession.phoneNumber)}`);
      console.log(`  Duration: ${durationMinutes}m ${durationSeconds}s`);
      console.log(`  Status: ${this.currentSession.isActive ? 'Active' : 'Inactive'}`);
    } else {
      console.log(chalk.gray('\n💤 No active session'));
    }
    console.log();
  }

  /**
   * Handle new USSD session initiation
   */
  private async handleNewSession(input: string): Promise<void> {
    // Validate phone number format
    if (!this.isValidPhoneNumber(input)) {
      console.log(chalk.red('❌ Invalid phone number format.'));
      console.log(chalk.gray('   Use international format (e.g., +254700123456)'));
      this.promptForAction();
      return;
    }

    // Create new session
    this.sessionCounter++;
    const sessionId = `mock_session_${this.sessionCounter}_${Date.now()}`;
    
    this.currentSession = {
      sessionId,
      phoneNumber: input,
      isActive: true,
      startTime: new Date()
    };

    console.log(chalk.green(`\n🔄 Starting USSD session for ${this.maskPhoneNumber(input)}`));
    console.log(chalk.gray(`Session ID: ${sessionId}\n`));

    // Initiate USSD session
    await this.processUSSDRequest('');
  }

  /**
   * Handle USSD input during active session
   */
  private async handleUSSDInput(input: string): Promise<void> {
    if (!this.currentSession) {
      console.log(chalk.red('❌ No active session'));
      this.promptForAction();
      return;
    }

    await this.processUSSDRequest(input);
  }

  /**
   * Process USSD request through the service
   */
  private async processUSSDRequest(input: string): Promise<void> {
    if (!this.currentSession) return;

    try {
      console.log(chalk.blue('📡 Processing USSD request...'));
      
      const response = await ussdService.handleUSSDRequest(
        this.currentSession.phoneNumber,
        input,
        this.currentSession.sessionId
      );

      // Display USSD response
      this.displayUSSDResponse(response.text);

      if (!response.continueSession) {
        console.log(chalk.yellow('\n📱 USSD session ended by service'));
        this.endCurrentSession();
      } else {
        this.promptForUSSDInput();
      }

    } catch (error: any) {
      console.log(chalk.red(`❌ USSD Error: ${error.message}`));
      console.log(chalk.yellow('📱 Session terminated due to error'));
      this.endCurrentSession();
    }
  }

  /**
   * Display USSD response in a formatted way
   */
  private displayUSSDResponse(text: string): void {
    console.log(chalk.cyan('\n┌─ USSD Response ─────────────────────┐'));
    
    const lines = text.split('\n');
    lines.forEach(line => {
      const paddedLine = line.padEnd(35);
      console.log(chalk.cyan('│ ') + chalk.white(paddedLine) + chalk.cyan(' │'));
    });
    
    console.log(chalk.cyan('└─────────────────────────────────────┘'));
  }

  /**
   * Prompt for USSD input
   */
  private promptForUSSDInput(): void {
    this.rl.setPrompt(chalk.magenta('USSD Input> '));
    this.rl.prompt();
  }

  /**
   * Prompt for general action
   */
  private promptForAction(): void {
    if (this.currentSession) {
      this.promptForUSSDInput();
    } else {
      this.rl.setPrompt(chalk.cyan('Enter phone number or command> '));
      this.rl.prompt();
    }
  }

  /**
   * End current USSD session
   */
  private endCurrentSession(): void {
    if (this.currentSession) {
      const sessionId = this.currentSession.sessionId;
      
      // End session in service
      ussdService.endSession(sessionId);
      
      const duration = Date.now() - this.currentSession.startTime.getTime();
      const durationSeconds = Math.floor(duration / 1000);
      
      console.log(chalk.gray(`\n🔚 Session ${sessionId} ended`));
      console.log(chalk.gray(`   Duration: ${durationSeconds} seconds`));
      
      this.currentSession = null;
    }
    
    this.promptForAction();
  }

  /**
   * Validate phone number format
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
   * Simulate network delay for realistic testing
   */
  private async simulateNetworkDelay(): Promise<void> {
    const delay = Math.random() * 1000 + 500; // 500-1500ms
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

// Main execution
async function main(): Promise<void> {
  console.log(chalk.blue('🚀 Starting ICPNomad USSD Mock CLI...\n'));
  
  // Check environment
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'development';
  }

  // Verify environment variables
  const requiredEnvVars = ['API_BASE_URL', 'USSD_SESSION_TIMEOUT'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.log(chalk.yellow('⚠️  Warning: Missing environment variables:'));
    missingVars.forEach(varName => {
      console.log(chalk.gray(`   ${varName}`));
    });
    console.log(chalk.gray('   Using default values...\n'));
  }

  // Start CLI
  const cli = new MockUSSDCLI();
  await cli.start();
}

// Handle unhandled errors
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('🚨 Unhandled Rejection at:'), promise, chalk.red('reason:'), reason);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  console.error(chalk.red('🚨 Uncaught Exception:'), error);
  process.exit(1);
});

// Start the CLI if this file is run directly
if (require.main === module) {
  main().catch(error => {
    console.error(chalk.red('🚨 Failed to start CLI:'), error);
    process.exit(1);
  });
}

export default MockUSSDCLI;