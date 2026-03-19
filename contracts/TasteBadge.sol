// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title TasteBadge
 * @dev Soulbound (non-transferable) ERC-721 token representing a "Taste Certified"
 * attestation. Minted by the Taste server when an agent consistently passes human
 * evaluation in a specific domain.
 *
 * Each badge carries on-chain metadata: domain, evaluation count, approval score,
 * and last update timestamp. Anyone can call getAttestation() to verify an agent's
 * human-reviewed quality record.
 *
 * Badges are non-transferable (soulbound) and can be revoked if quality degrades.
 */
contract TasteBadge is ERC721, Ownable2Step {

    // ── Types ──

    struct Attestation {
        string domain;           // e.g. "content", "trust", "creative"
        uint256 evaluationCount; // total human evaluations
        uint256 approvalCount;   // evaluations where verdict was approve
        uint256 lastUpdatedAt;
        bool active;
    }

    // ── State ──

    uint256 private _nextTokenId;
    mapping(uint256 => Attestation) public attestations;

    /// @dev agent address + domain hash => tokenId (0 = no badge)
    mapping(bytes32 => uint256) private _agentDomainToToken;

    // ── Events ──

    event BadgeMinted(uint256 indexed tokenId, address indexed agent, string domain);
    event BadgeUpdated(uint256 indexed tokenId, uint256 evaluationCount, uint256 approvalCount);
    event BadgeRevoked(uint256 indexed tokenId, address indexed agent);

    // ── Errors ──

    error Soulbound();
    error BadgeExists();
    error NoBadge();

    // ── Constructor ──

    constructor(address owner_) payable ERC721("Taste Certified", "TASTE") Ownable(owner_) {}

    // ── Core ──

    /// @dev Mint a new badge for an agent in a specific domain
    function mint(
        address agent,
        string calldata domain,
        uint256 evaluationCount,
        uint256 approvalCount
    ) external onlyOwner returns (uint256) {
        bytes32 key = keccak256(abi.encodePacked(agent, domain));
        if (_agentDomainToToken[key] != 0) revert BadgeExists();

        uint256 tokenId = ++_nextTokenId;
        _safeMint(agent, tokenId);

        attestations[tokenId] = Attestation({
            domain: domain,
            evaluationCount: evaluationCount,
            approvalCount: approvalCount,
            lastUpdatedAt: block.timestamp,
            active: true
        });

        _agentDomainToToken[key] = tokenId;

        emit BadgeMinted(tokenId, agent, domain);
        return tokenId;
    }

    /// @dev Update attestation data (e.g. after more evaluations)
    function update(
        uint256 tokenId,
        uint256 evaluationCount,
        uint256 approvalCount
    ) external onlyOwner {
        if (tokenId == 0 || tokenId > _nextTokenId) revert NoBadge();
        Attestation storage att = attestations[tokenId];
        if (!att.active) revert NoBadge();

        att.evaluationCount = evaluationCount;
        att.approvalCount = approvalCount;
        att.lastUpdatedAt = block.timestamp;

        emit BadgeUpdated(tokenId, evaluationCount, approvalCount);
    }

    /// @dev Revoke a badge (quality degraded below threshold)
    function revoke(uint256 tokenId) external onlyOwner {
        if (tokenId == 0 || tokenId > _nextTokenId) revert NoBadge();
        Attestation storage att = attestations[tokenId];
        if (!att.active) revert NoBadge();

        att.active = false;
        address agent = ownerOf(tokenId);
        _burn(tokenId);

        emit BadgeRevoked(tokenId, agent);
    }

    // ── Views ──

    /// @dev Public attestation lookup — the key function other contracts/agents call
    function getAttestation(address agent, string calldata domain)
        external
        view
        returns (uint256 evaluationCount, uint256 approvalCount, uint256 lastUpdatedAt, bool active)
    {
        bytes32 key = keccak256(abi.encodePacked(agent, domain));
        uint256 tokenId = _agentDomainToToken[key];
        if (tokenId == 0) return (0, 0, 0, false);

        Attestation memory att = attestations[tokenId];
        return (att.evaluationCount, att.approvalCount, att.lastUpdatedAt, att.active);
    }

    /// @dev Get token ID for an agent+domain pair
    function getBadgeId(address agent, string calldata domain) external view returns (uint256) {
        return _agentDomainToToken[keccak256(abi.encodePacked(agent, domain))];
    }

    // ── Soulbound enforcement ──

    /// @dev Block all transfers — badges are non-transferable
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        // Allow minting (from == address(0)) and burning (to == address(0))
        if (from != address(0)) {
            if (to != address(0)) revert Soulbound();
        }
        return super._update(to, tokenId, auth);
    }
}
