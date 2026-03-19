// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";

/**
 * @title TasteContentCertificate
 * @dev On-chain registry of human-reviewed content. When a Taste expert approves
 * a piece of AI-generated content, the content hash is recorded here with the
 * review metadata. Anyone can verify whether a specific piece of content was
 * human-reviewed by calling verify().
 *
 * Use cases:
 * - Agent attaches certificateId to published content as proof of human review
 * - Downstream consumers verify content was quality-checked before trusting it
 * - EU AI Act compliance: documented human review with on-chain audit trail
 * - Platforms can filter for "Taste Certified" content
 *
 * Content is identified by keccak256 hash — the actual content never goes on-chain.
 */
contract TasteContentCertificate is Ownable2Step {

    // ── Types ──

    struct Certificate {
        bytes32 contentHash;     // keccak256 of the reviewed content
        address agent;           // the agent that requested review
        string offeringType;     // e.g. "content_quality_gate", "output_quality_gate"
        string verdict;          // "approved", "approved_with_changes"
        string domain;           // reviewer expertise domain
        uint256 issuedAt;
        bool valid;
    }

    // ── State ──

    uint256 private _nextCertId;
    mapping(uint256 => Certificate) public certificates;

    /// @dev contentHash => certificateId (latest cert for this content)
    mapping(bytes32 => uint256) public contentToCertificate;

    /// @dev agent => certificateId[] (all certs for this agent)
    mapping(address => uint256[]) private _agentCertificates;

    // ── Events ──

    event CertificateIssued(
        uint256 indexed certId,
        bytes32 indexed contentHash,
        address indexed agent,
        string offeringType,
        string verdict
    );

    event CertificateRevoked(uint256 indexed certId, bytes32 indexed contentHash);

    // ── Errors ──

    error InvalidCertificate();
    error EmptyHash();

    // ── Constructor ──

    constructor(address owner_) payable Ownable(owner_) {}

    // ── Core ──

    /// @dev Issue a certificate after human expert approves content
    function issue(
        bytes32 contentHash,
        address agent,
        string calldata offeringType,
        string calldata verdict,
        string calldata domain
    ) external onlyOwner returns (uint256) {
        if (contentHash == bytes32(0)) revert EmptyHash();

        uint256 certId = ++_nextCertId;

        certificates[certId] = Certificate({
            contentHash: contentHash,
            agent: agent,
            offeringType: offeringType,
            verdict: verdict,
            domain: domain,
            issuedAt: block.timestamp,
            valid: true
        });

        contentToCertificate[contentHash] = certId;
        _agentCertificates[agent].push(certId);

        emit CertificateIssued(certId, contentHash, agent, offeringType, verdict);
        return certId;
    }

    /// @dev Revoke a certificate (e.g. if content was later found problematic)
    function revoke(uint256 certId) external onlyOwner {
        Certificate storage cert = certificates[certId];
        if (!cert.valid) revert InvalidCertificate();

        cert.valid = false;
        emit CertificateRevoked(certId, cert.contentHash);
    }

    // ── Verification (the key public API) ──

    /// @dev Verify content by its hash — returns true if valid certificate exists
    function verify(bytes32 contentHash)
        external
        view
        returns (bool certified, uint256 certId, string memory verdict, uint256 issuedAt)
    {
        certId = contentToCertificate[contentHash];
        if (certId == 0) return (false, 0, "", 0);

        Certificate memory cert = certificates[certId];
        return (cert.valid, certId, cert.verdict, cert.issuedAt);
    }

    /// @dev Full certificate details by ID
    function getCertificate(uint256 certId) external view returns (Certificate memory) {
        return certificates[certId];
    }

    /// @dev Get all certificate IDs for an agent
    function getAgentCertificates(address agent) external view returns (uint256[] memory) {
        return _agentCertificates[agent];
    }

    /// @dev Total certificates issued
    function totalCertificates() external view returns (uint256) {
        return _nextCertId;
    }
}
