require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config();

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  paths: {
    sources:  './src',    // PredictionMarket.sol lives in src/
    tests:    './test',
    cache:    './cache',
    artifacts:'./artifacts',
  },
  networks: {
    hardhat: {
      // Local in-process network used for tests
    },
    sepolia: {
      url:      process.env.ETHEREUM_RPC_URL || '',
      accounts: process.env.BACKEND_WALLET_PRIVATE_KEY
        ? [process.env.BACKEND_WALLET_PRIVATE_KEY]
        : [],
    },
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY || '',
  },
};
