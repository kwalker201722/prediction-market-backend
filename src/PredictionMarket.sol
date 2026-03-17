// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title PredictionMarket
 * @notice Manages prediction market creation, resolution and (future) dispute
 *         handling for any tradable ticker / event.
 *
 * Architecture:
 *  - An owner-controlled set of authorized oracle signers can settle markets.
 *  - Settlement is finalized by calling resolveMarket() with a price, an
 *    outcome index, and an EIP-191 signature over the deterministic payload.
 *  - After settlement there is a DISPUTE_WINDOW during which an authorized
 *    disputer may flag the result; full on-chain arbitration logic (bonds,
 *    slashing) is left as a Step-4 extension point.
 */
contract PredictionMarket {
    // -------------------------------------------------------------------------
    // Types
    // -------------------------------------------------------------------------

    enum MarketStatus {
        Open,      // accepting positions
        Closed,    // expiry passed, awaiting settlement
        Settled,   // resolved – outcome & price recorded
        Disputed   // settlement challenged during dispute window
    }

    struct Market {
        uint256 marketId;
        string  ticker;         // e.g. "AAPL", "BTC-USD"
        uint256 expiryDate;     // unix timestamp
        MarketStatus status;

        // Settlement data (populated by resolveMarket)
        uint256 outcome;        // outcome index (0 = no/below, 1 = yes/above, …)
        uint256 price;          // settlement price with 8 decimal places
        address resolver;       // oracle address that signed the payload
        bytes32 evidenceHash;   // keccak256 of the evidence string
        uint256 settledAt;      // block.timestamp of settlement

        // Dispute window (Step 4 – bond/slashing logic to be added)
        bool    disputed;
        address disputer;
        uint256 disputedAt;
        string  disputeReason;
    }

    // -------------------------------------------------------------------------
    // Constants
    // -------------------------------------------------------------------------

    /// @dev Duration (in seconds) after settlement during which a dispute
    ///      may be raised.  Set to 48 hours for production; shorten for tests.
    uint256 public constant DISPUTE_WINDOW = 48 hours;

    // -------------------------------------------------------------------------
    // Storage
    // -------------------------------------------------------------------------

    address public owner;

    /// @dev Addresses permitted to sign settlement payloads.
    mapping(address => bool) public authorizedOracles;

    /// @dev All markets by id.
    mapping(uint256 => Market) public markets;

    /// @dev Simple counter for auto-incrementing market ids.
    uint256 public marketCount;

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------

    event MarketCreated(
        uint256 indexed marketId,
        string  ticker,
        uint256 expiryDate
    );

    event MarketResolved(
        uint256 indexed marketId,
        uint256 outcome,
        uint256 price,
        address indexed resolver,
        bytes32 evidenceHash,
        uint256 settledAt
    );

    event MarketDisputed(
        uint256 indexed marketId,
        address indexed disputer,
        string  reason,
        uint256 disputedAt
    );

    event OracleAdded(address indexed oracle);
    event OracleRemoved(address indexed oracle);

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "PredictionMarket: caller is not owner");
        _;
    }

    modifier marketExists(uint256 marketId) {
        require(markets[marketId].marketId == marketId, "PredictionMarket: market not found");
        _;
    }

    // -------------------------------------------------------------------------
    // Constructor
    // -------------------------------------------------------------------------

    constructor() {
        owner = msg.sender;
        authorizedOracles[msg.sender] = true;
        emit OracleAdded(msg.sender);
    }

    // -------------------------------------------------------------------------
    // Admin – oracle management
    // -------------------------------------------------------------------------

    /**
     * @notice Grant oracle/signing rights to an address.
     * @param oracle Address to authorize.
     */
    function addOracle(address oracle) external onlyOwner {
        require(oracle != address(0), "PredictionMarket: zero address");
        authorizedOracles[oracle] = true;
        emit OracleAdded(oracle);
    }

    /**
     * @notice Revoke oracle/signing rights from an address.
     * @param oracle Address to revoke.
     */
    function removeOracle(address oracle) external onlyOwner {
        authorizedOracles[oracle] = false;
        emit OracleRemoved(oracle);
    }

    /**
     * @notice Transfer contract ownership.
     * @param newOwner New owner address.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "PredictionMarket: zero address");
        owner = newOwner;
    }

    // -------------------------------------------------------------------------
    // Market lifecycle
    // -------------------------------------------------------------------------

    /**
     * @notice Create a new prediction market.
     * @param ticker    Asset/event ticker symbol.
     * @param expiryDate Unix timestamp after which the market may be settled.
     * @return marketId Newly assigned market id.
     */
    function createMarket(
        string calldata ticker,
        uint256 expiryDate
    ) external onlyOwner returns (uint256 marketId) {
        require(bytes(ticker).length > 0, "PredictionMarket: empty ticker");
        require(expiryDate > block.timestamp, "PredictionMarket: expiry in the past");

        marketCount++;
        marketId = marketCount;

        markets[marketId] = Market({
            marketId:    marketId,
            ticker:      ticker,
            expiryDate:  expiryDate,
            status:      MarketStatus.Open,
            outcome:     0,
            price:       0,
            resolver:    address(0),
            evidenceHash: bytes32(0),
            settledAt:   0,
            disputed:    false,
            disputer:    address(0),
            disputedAt:  0,
            disputeReason: ""
        });

        emit MarketCreated(marketId, ticker, expiryDate);
    }

    // -------------------------------------------------------------------------
    // Settlement – Step 1 core function
    // -------------------------------------------------------------------------

    /**
     * @notice Resolve / settle a prediction market.
     *
     * The caller must be an authorized oracle.  The `signature` parameter must
     * be an EIP-191 personal_sign over the deterministic payload:
     *
     *   "Settlement:marketId=<id>,outcome=<n>,price=<p>,evidenceHash=<h>"
     *
     * This matches the message built by the oracle-bot (settlement-bot.ts /
     * oracleBot.js) via buildSettlementMessage().
     *
     * @param marketId     On-chain market identifier.
     * @param outcome      Resolved outcome index (0 = no/below, 1 = yes/above).
     * @param price        Settlement price with 8 decimal places (uint256).
     * @param signature    EIP-191 signature bytes from the authorized oracle.
     * @param evidenceHash keccak256 hash of the evidence / provenance string.
     */
    function resolveMarket(
        uint256 marketId,
        uint256 outcome,
        uint256 price,
        bytes calldata signature,
        bytes32 evidenceHash
    ) external marketExists(marketId) {
        Market storage m = markets[marketId];

        require(
            m.status == MarketStatus.Open || m.status == MarketStatus.Closed,
            "PredictionMarket: market already settled or disputed"
        );
        require(
            block.timestamp >= m.expiryDate,
            "PredictionMarket: market has not expired yet"
        );

        // Recover signer from EIP-191 signature
        bytes32 msgHash = _buildSettlementHash(marketId, outcome, price, evidenceHash);
        address signer = _recoverSigner(msgHash, signature);

        require(
            authorizedOracles[signer],
            "PredictionMarket: signer is not an authorized oracle"
        );

        // Persist settlement state
        m.status       = MarketStatus.Settled;
        m.outcome      = outcome;
        m.price        = price;
        m.resolver     = signer;
        m.evidenceHash = evidenceHash;
        m.settledAt    = block.timestamp;

        emit MarketResolved(marketId, outcome, price, signer, evidenceHash, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Dispute window – Step 4 extension point
    // -------------------------------------------------------------------------

    /**
     * @notice Open a dispute on a recently settled market.
     *
     * During the DISPUTE_WINDOW after settlement any authorized oracle (or,
     * in a future version, any bonded disputer) may challenge the result.
     *
     * Full arbitration logic (counter-evidence, bond slashing, re-resolution)
     * is a Step-4 on-chain extension.  For now this function simply flags the
     * market as Disputed so the admin UI can surface it for manual review.
     *
     * @param marketId Market to dispute.
     * @param reason   Human-readable reason for the dispute.
     */
    function disputeMarket(
        uint256 marketId,
        string calldata reason
    ) external marketExists(marketId) {
        Market storage m = markets[marketId];

        require(
            m.status == MarketStatus.Settled,
            "PredictionMarket: market is not in Settled state"
        );
        require(
            block.timestamp <= m.settledAt + DISPUTE_WINDOW,
            "PredictionMarket: dispute window has closed"
        );
        require(bytes(reason).length > 0, "PredictionMarket: reason required");

        // Step 4: require a bond deposit here before accepting the dispute.
        // e.g. require(bondToken.transferFrom(msg.sender, address(this), BOND_AMOUNT));

        m.status       = MarketStatus.Disputed;
        m.disputed     = true;
        m.disputer     = msg.sender;
        m.disputedAt   = block.timestamp;
        m.disputeReason = reason;

        emit MarketDisputed(marketId, msg.sender, reason, block.timestamp);
    }

    // -------------------------------------------------------------------------
    // Views
    // -------------------------------------------------------------------------

    /**
     * @notice Return the full state of a market.
     */
    function getMarket(uint256 marketId)
        external
        view
        marketExists(marketId)
        returns (Market memory)
    {
        return markets[marketId];
    }

    /**
     * @notice Check whether an address is an authorized oracle.
     */
    function isOracle(address addr) external view returns (bool) {
        return authorizedOracles[addr];
    }

    // -------------------------------------------------------------------------
    // Internal helpers
    // -------------------------------------------------------------------------

    /**
     * @dev Build the EIP-191 message hash that the oracle-bot signs.
     *      Must match buildSettlementMessage() in oracle-bot/settlement-bot.ts.
     */
    function _buildSettlementHash(
        uint256 marketId,
        uint256 outcome,
        uint256 price,
        bytes32 evidenceHash
    ) internal pure returns (bytes32) {
        // Construct the same deterministic string the bot signs:
        // "Settlement:marketId=<id>,outcome=<n>,price=<p>,evidenceHash=<h>"
        string memory message = string(
            abi.encodePacked(
                "Settlement:marketId=", _uint256ToString(marketId),
                ",outcome=",            _uint256ToString(outcome),
                ",price=",              _uint256ToString(price),
                ",evidenceHash=",       _bytes32ToHex(evidenceHash)
            )
        );

        // EIP-191 personal_sign prefix
        return keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n",
                _uint256ToString(bytes(message).length),
                message
            )
        );
    }

    /**
     * @dev Recover the signer address from an EIP-191 hash + signature.
     */
    function _recoverSigner(bytes32 hash, bytes calldata sig)
        internal
        pure
        returns (address)
    {
        require(sig.length == 65, "PredictionMarket: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8   v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := shr(248, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "PredictionMarket: invalid v value");
        return ecrecover(hash, v, r, s);
    }

    /**
     * @dev Convert a uint256 to its decimal string representation.
     */
    function _uint256ToString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits -= 1;
            buffer[digits] = bytes1(uint8(48 + uint256(value % 10)));
            value /= 10;
        }
        return string(buffer);
    }

    /**
     * @dev Convert bytes32 to a "0x…" hex string (64 hex chars + prefix).
     */
    function _bytes32ToHex(bytes32 data) internal pure returns (string memory) {
        bytes memory hexChars = "0123456789abcdef";
        bytes memory result = new bytes(66);
        result[0] = '0';
        result[1] = 'x';
        for (uint256 i = 0; i < 32; i++) {
            result[2 + i * 2]     = hexChars[uint8(data[i]) >> 4];
            result[2 + i * 2 + 1] = hexChars[uint8(data[i]) & 0x0f];
        }
        return string(result);
    }
}
