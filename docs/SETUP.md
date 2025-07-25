# ICPNomad Setup Guide

This guide will help you set up the ICPNomad development environment from scratch.

## Prerequisites

Before starting, ensure you have the following installed:

- **Node.js** (v16 or higher)
- **pnpm** (v8 or higher)
- **Git**
- **curl** (for dfx installation)

## Step 1: Install DFINITY Canister SDK (dfx)

Install dfx version 0.15+ globally:

```bash
# Install dfx
sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"

# Verify installation
dfx --version

# Add dfx to your PATH (if not automatically added)
echo 'export PATH="$HOME/.local/share/dfx/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc
```

## Step 2: Clone and Initialize Project

```bash
# Clone the repository (replace with actual repository URL)
git clone <repository-url> icpnomad
cd icpnomad

# Make setup script executable and run it
chmod +x setup-structure.sh
./setup-structure.sh

# Install Node.js dependencies
pnpm install
```

## Step 3: Environment Configuration

```bash
# Copy environment template
cp .env.example .env

# Edit the .env file with your preferred editor
nano .env  # or vim .env or code .env
```

Key variables to configure:
- `JWT_SECRET`: Change to a secure random string
- `PIN_SALT_ROUNDS`: Keep as 12 for security
- `PHONE_HASH_SECRET`: Change to a secure random string
- `MONGODB_URI`: Configure if using MongoDB (optional)

## Step 4: Start Local ICP Replica

```bash
# Start the local ICP replica in the background
dfx start --background

# Verify it's running
dfx ping local
```

## Step 5: Deploy Canisters

```bash
# Deploy all canisters to local network
dfx deploy --network local

# Check deployment status
dfx canister status --all --network local
```

## Step 6: Configure Canister IDs

After deployment, update your `.env` file with the canister IDs:

```bash
# Get canister IDs
dfx canister id icpnomad_wallet --network local
dfx canister id icpnomad_backend --network local

# Add these IDs to your .env file
echo "CANISTER_ID_ICPNOMAD_WALLET=$(dfx canister id icpnomad_wallet --network local)" >> .env
echo "CANISTER_ID_ICPNOMAD_BACKEND=$(dfx canister id icpnomad_backend --network local)" >> .env
```

## Step 7: Build and Start Development Server

```bash
# Build the TypeScript project
pnpm run build

# Start development server with hot reload
pnpm run dev

# Or start production server
pnpm start
```

## Step 8: Test USSD Interface (Optional)

```bash
# Test the mock USSD interface
pnpm run mock-ussd
```

## Step 9: Verify Installation

Check that everything is working:

1. **ICP Replica**: Visit http://127.0.0.1:4943/_/dashboard
2. **Backend API**: Visit http://localhost:3000/health (after implementing health endpoint)
3. **Canister Status**: Run `dfx canister call icpnomad_wallet getCanisterStatus`

## Development Workflow

### Daily Development

```bash
# Start local ICP replica (if not running)
dfx start --background

# Start development server
pnpm run dev

# In another terminal, deploy canisters after changes
dfx deploy --network local
```

### Code Quality

```bash
# Run linting
pnpm run lint

# Fix linting issues
pnpm run lint:fix

# Run tests
pnpm test

# Run tests in watch mode
pnpm run test:watch
```

### Building for Production

```bash
# Build the project
pnpm run build

# Deploy to IC mainnet (when ready)
dfx deploy --network ic
```

## Troubleshooting

### Common Issues

1. **dfx command not found**
   ```bash
   # Add dfx to PATH
   export PATH="$HOME/.local/share/dfx/bin:$PATH"
   ```

2. **Port 4943 already in use**
   ```bash
   # Stop existing dfx instance
   dfx stop
   dfx start --background
   ```

3. **Canister deployment fails**
   ```bash
   # Reset local state
   dfx stop
   rm -rf .dfx
   dfx start --background
   dfx deploy
   ```

4. **Node.js version issues**
   ```bash
   # Check Node.js version
   node --version
   # Should be v16 or higher
   ```

### Logs and Debugging

- **dfx logs**: `dfx logs --network local`
- **Application logs**: Check `logs/icpnomad.log`
- **Canister logs**: `dfx canister logs icpnomad_wallet --network local`

## Next Steps

1. Implement canister logic in `src/canisters/ICPNomadWallet.mo`
2. Develop USSD service logic in `src/ussd/`
3. Create API endpoints in `src/routes/`
4. Implement business logic in `src/services/`
5. Add comprehensive tests in `tests/`

## Additional Resources

- [DFINITY Documentation](https://internetcomputer.org/docs/current/developer-docs/)
- [Motoko Language Guide](https://internetcomputer.org/docs/current/motoko/main/motoko)
- [ICP Developer Tools](https://internetcomputer.org/docs/current/developer-docs/setup/install/)

For more detailed information about the project architecture, see the main [README.md](README.md).