/**
 * PredictionMarket contract tests (Hardhat + ethers.js)
 *
 * Run:
 *   npx hardhat test
 *   npx hardhat test --grep "resolveMarket"
 *
 * These tests run against Hardhat's in-process EVM – no live network needed.
 */

const { expect } = require('chai');
const { ethers }  = require('hardhat');

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/** Return the latest EVM block timestamp as BigInt. */
async function latestTimestamp() {
  const block = await ethers.provider.getBlock('latest');
  return BigInt(block.timestamp);
}

/**
 * Build the same settlement message string that the contract hashes
 * (and that oracleBot.js signs).
 */
function buildSettlementMessage(marketId, outcome, price, evidenceHash) {
  return (
    `Settlement:marketId=${marketId},` +
    `outcome=${outcome},` +
    `price=${price},` +
    `evidenceHash=${evidenceHash}`
  );
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PredictionMarket', function () {
  let contract;
  let owner;
  let oracle;
  let user;

  beforeEach(async function () {
    [owner, oracle, user] = await ethers.getSigners();

    const Factory = await ethers.getContractFactory('PredictionMarket');
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  // ── Deployment ─────────────────────────────────────────────────────────────

  describe('deployment', function () {
    it('sets owner correctly', async function () {
      expect(await contract.owner()).to.equal(owner.address);
    });

    it('authorizes owner as oracle on deploy', async function () {
      expect(await contract.isOracle(owner.address)).to.be.true;
    });

    it('has marketCount of 0 initially', async function () {
      expect(await contract.marketCount()).to.equal(0n);
    });
  });

  // ── Oracle management ──────────────────────────────────────────────────────

  describe('oracle management', function () {
    it('owner can add an oracle', async function () {
      await expect(contract.addOracle(oracle.address))
        .to.emit(contract, 'OracleAdded')
        .withArgs(oracle.address);
      expect(await contract.isOracle(oracle.address)).to.be.true;
    });

    it('owner can remove an oracle', async function () {
      await contract.addOracle(oracle.address);
      await expect(contract.removeOracle(oracle.address))
        .to.emit(contract, 'OracleRemoved')
        .withArgs(oracle.address);
      expect(await contract.isOracle(oracle.address)).to.be.false;
    });

    it('non-owner cannot add an oracle', async function () {
      await expect(
        contract.connect(user).addOracle(oracle.address)
      ).to.be.revertedWith('PredictionMarket: caller is not owner');
    });

    it('reverts adding zero address', async function () {
      await expect(
        contract.addOracle(ethers.ZeroAddress)
      ).to.be.revertedWith('PredictionMarket: zero address');
    });
  });

  // ── Market creation ────────────────────────────────────────────────────────

  describe('createMarket', function () {
    it('creates a market and emits MarketCreated', async function () {
      // Use EVM timestamp + 1 day as future expiry
      const now    = await latestTimestamp();
      const future = now + 86400n;

      await expect(contract.createMarket('AAPL', future))
        .to.emit(contract, 'MarketCreated')
        .withArgs(1n, 'AAPL', future);

      expect(await contract.marketCount()).to.equal(1n);
      const m = await contract.getMarket(1n);
      expect(m.ticker).to.equal('AAPL');
      expect(m.status).to.equal(0n); // MarketStatus.Open
    });

    it('reverts for empty ticker', async function () {
      const now    = await latestTimestamp();
      const future = now + 86400n;
      await expect(
        contract.createMarket('', future)
      ).to.be.revertedWith('PredictionMarket: empty ticker');
    });

    it('reverts when expiry is in the past', async function () {
      // block.timestamp is the current EVM time; subtract to get a past value
      const now  = await latestTimestamp();
      const past = now - 1n;
      await expect(
        contract.createMarket('AAPL', past)
      ).to.be.revertedWith('PredictionMarket: expiry in the past');
    });

    it('only owner can create a market', async function () {
      const now    = await latestTimestamp();
      const future = now + 86400n;
      await expect(
        contract.connect(user).createMarket('AAPL', future)
      ).to.be.revertedWith('PredictionMarket: caller is not owner');
    });
  });

  // ── resolveMarket ──────────────────────────────────────────────────────────

  describe('resolveMarket', function () {
    let marketId;
    let expiryOffset;  // seconds from now used for FUTURE

    beforeEach(async function () {
      expiryOffset = 86400; // 1 day
      const now    = await latestTimestamp();
      const future = now + BigInt(expiryOffset);

      const tx = await contract.createMarket('AAPL', future);
      await tx.wait();
      marketId = 1n;

      // Fast-forward EVM time past expiry
      await ethers.provider.send('evm_increaseTime', [expiryOffset + 1]);
      await ethers.provider.send('evm_mine', []);
    });

    it('settles a market with a valid oracle signature', async function () {
      const outcome      = 1n;
      const priceUint256 = ethers.parseUnits('150.00000000', 8); // 8 decimals
      const evidenceStr  = 'AAPL:2024-01-19:150';
      const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes(evidenceStr));

      const message = buildSettlementMessage(marketId, outcome, priceUint256, evidenceHash);
      const sig     = await owner.signMessage(message);

      await contract.resolveMarket(marketId, outcome, priceUint256, sig, evidenceHash);

      // Capture timestamp after tx is mined
      const settledAt = await latestTimestamp();

      const m = await contract.getMarket(marketId);
      expect(m.status).to.equal(2n);   // MarketStatus.Settled
      expect(m.outcome).to.equal(outcome);
      expect(m.price).to.equal(priceUint256);
      expect(m.resolver).to.equal(owner.address);
      expect(m.settledAt).to.equal(settledAt);
    });

    it('emits MarketResolved event', async function () {
      const outcome      = 1n;
      const priceUint256 = ethers.parseUnits('150.00000000', 8);
      const evidenceHash = ethers.ZeroHash;

      const message = buildSettlementMessage(marketId, outcome, priceUint256, evidenceHash);
      const sig     = await owner.signMessage(message);

      await expect(
        contract.resolveMarket(marketId, outcome, priceUint256, sig, evidenceHash)
      ).to.emit(contract, 'MarketResolved');
    });

    it('reverts with unauthorized signer', async function () {
      const outcome      = 1n;
      const priceUint256 = ethers.parseUnits('150.00000000', 8);
      const evidenceHash = ethers.ZeroHash;

      const message = buildSettlementMessage(marketId, outcome, priceUint256, evidenceHash);

      // Sign with a non-oracle account
      const sig = await user.signMessage(message);

      await expect(
        contract.resolveMarket(marketId, outcome, priceUint256, sig, evidenceHash)
      ).to.be.revertedWith('PredictionMarket: signer is not an authorized oracle');
    });

    it('reverts before expiry', async function () {
      // Deploy a fresh market with a far-future expiry (2 years from now in EVM)
      const now       = await latestTimestamp();
      const farFuture = now + BigInt(365 * 2 * 86400);
      await contract.createMarket('BTC', farFuture);
      const newId        = 2n;
      const outcome      = 1n;
      const priceUint256 = ethers.parseUnits('60000.00000000', 8);
      const evidenceHash = ethers.ZeroHash;

      const message = buildSettlementMessage(newId, outcome, priceUint256, evidenceHash);
      const sig     = await owner.signMessage(message);

      await expect(
        contract.resolveMarket(newId, outcome, priceUint256, sig, evidenceHash)
      ).to.be.revertedWith('PredictionMarket: market has not expired yet');
    });

    it('reverts double-settlement', async function () {
      const outcome      = 1n;
      const priceUint256 = ethers.parseUnits('150.00000000', 8);
      const evidenceHash = ethers.ZeroHash;

      const message = buildSettlementMessage(marketId, outcome, priceUint256, evidenceHash);
      const sig     = await owner.signMessage(message);

      // First settlement – should succeed
      await contract.resolveMarket(marketId, outcome, priceUint256, sig, evidenceHash);

      // Second settlement – should fail
      await expect(
        contract.resolveMarket(marketId, outcome, priceUint256, sig, evidenceHash)
      ).to.be.revertedWith('PredictionMarket: market already settled or disputed');
    });
  });

  // ── disputeMarket ──────────────────────────────────────────────────────────

  describe('disputeMarket', function () {
    let marketId;
    const expiryOffset = 86400;

    beforeEach(async function () {
      const now    = await latestTimestamp();
      const future = now + BigInt(expiryOffset);

      await contract.createMarket('TSLA', future);
      marketId = 1n;

      // Fast-forward past expiry and settle
      await ethers.provider.send('evm_increaseTime', [expiryOffset + 1]);
      await ethers.provider.send('evm_mine', []);

      const outcome      = 1n;
      const priceUint256 = ethers.parseUnits('200.00000000', 8);
      const evidenceHash = ethers.ZeroHash;
      const message      = buildSettlementMessage(marketId, outcome, priceUint256, evidenceHash);
      const sig          = await owner.signMessage(message);
      await contract.resolveMarket(marketId, outcome, priceUint256, sig, evidenceHash);
    });

    it('allows dispute within window', async function () {
      await expect(
        contract.connect(user).disputeMarket(marketId, 'Price data was incorrect')
      )
        .to.emit(contract, 'MarketDisputed');

      const m = await contract.getMarket(marketId);
      expect(m.status).to.equal(3n); // MarketStatus.Disputed
      expect(m.disputed).to.be.true;
    });

    it('reverts dispute on non-settled market', async function () {
      const now    = await latestTimestamp();
      const future = now + 86400n;
      await contract.createMarket('ETH', future);
      await expect(
        contract.disputeMarket(2n, 'reason')
      ).to.be.revertedWith('PredictionMarket: market is not in Settled state');
    });

    it('reverts dispute after window closes', async function () {
      // Fast-forward past the 48-hour dispute window
      await ethers.provider.send('evm_increaseTime', [48 * 3600 + 1]);
      await ethers.provider.send('evm_mine', []);

      await expect(
        contract.connect(user).disputeMarket(marketId, 'Too late')
      ).to.be.revertedWith('PredictionMarket: dispute window has closed');
    });
  });

  // ── Ownership transfer ─────────────────────────────────────────────────────

  describe('transferOwnership', function () {
    it('transfers ownership to new address', async function () {
      await contract.transferOwnership(oracle.address);
      expect(await contract.owner()).to.equal(oracle.address);
    });

    it('non-owner cannot transfer ownership', async function () {
      await expect(
        contract.connect(user).transferOwnership(user.address)
      ).to.be.revertedWith('PredictionMarket: caller is not owner');
    });
  });
});

