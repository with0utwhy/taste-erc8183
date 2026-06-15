// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseERC8183Hook} from "../BaseERC8183Hook.sol";
import {IERC8183HookMetadata} from "../interfaces/IERC8183HookMetadata.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title OwnerApprovalHook
/// @notice Profile A (Simple Policy) hook: a job cannot be funded until a
///         designated owner has approved its budget via an off-chain signature.
///         No token custody.
///
/// USE CASE
///   An AI agent's human operator gates the agent's spending. The agent can
///   create and run jobs, but funds only move once the human signs off on the
///   budget — a human-in-the-loop oversight lane on ERC-8183 with no trusted
///   intermediary.
///
/// FLOW
///   1. `setBudget` optParams carry `abi.encode(owner)`. The owner is recorded
///      once (falls back to the caller if none is given) and
///      `ApprovalRequested(jobId, owner, client, budget)` is emitted for an
///      off-chain notifier.
///   2. The owner signs the job terms off-chain (gasless) as EIP-712 typed data
///      — `Approval(uint256 jobId,uint256 budget,uint256 deadline)` under this
///      contract's domain — so the wallet shows human-readable fields, not an
///      opaque hash.
///   3. `fund` optParams carry `abi.encode(signature, deadline)`. `_preFund`
///      validates the signature against the recorded owner (an EOA via ECDSA, or
///      a smart-contract wallet via ERC-1271) with the deadline still in the
///      future; a missing or invalid signature reverts.
///
/// TRUST MODEL
///   - No approval state and no mutating functions outside the ERC-8183
///     callbacks; no admin, no upgradeability. Only a valid signature from the
///     recorded owner — an EOA (ECDSA) or a smart-contract wallet (ERC-1271) —
///     can unblock funding.
///   - The owner is locked on first `setBudget` (no later swap). The budget is
///     bound into the signed payload, so raising it invalidates a prior approval
///     (no escalation). The EIP-712 domain binds the signature to this hook on
///     this chain, and `jobId` binds it to one job (no replay).
///   - Denial needs no transaction: an unsigned job can never be funded, and the
///     deadline bounds each signature. The deadline must also fall within a
///     bounded window (MAX_APPROVAL_WINDOW), so an approval cannot accidentally
///     be made effectively non-expiring.
contract OwnerApprovalHook is BaseERC8183Hook, IERC8183HookMetadata, EIP712 {
    /// @notice Per-job approval context.
    struct Job {
        address owner; // the only address whose signature can approve this job
        uint256 budget; // last budget seen at setBudget; bound into the signed payload
    }

    mapping(uint256 => Job) private _jobs;

    /// @notice EIP-712 type hash for the owner's approval payload.
    bytes32 private constant APPROVAL_TYPEHASH =
        keccak256("Approval(uint256 jobId,uint256 budget,uint256 deadline)");

    /// @notice Upper bound on how far ahead an approval deadline may be set, so a
    ///         signature cannot accidentally be made effectively non-expiring.
    uint256 private constant MAX_APPROVAL_WINDOW = 30 days;

    /// @notice Emitted when a job is registered and awaiting owner approval.
    event ApprovalRequested(uint256 indexed jobId, address indexed owner, address indexed client, uint256 budget);

    error OwnerNotRegistered();
    error ApprovalExpired();
    error ApprovalWindowTooLong();
    error InvalidApprovalSignature();

    /// @param erc8183Contract_ The ERC-8183 core contract (or MultiHookRouter) authorized to call this hook.
    constructor(address erc8183Contract_) BaseERC8183Hook(erc8183Contract_) EIP712("OwnerApprovalHook", "1") {}

    /// @inheritdoc IERC8183HookMetadata
    /// @dev The owner is captured at setBudget and consumed at fund, so both
    ///      selectors must be routed to this hook together.
    function requiredSelectors() external pure returns (bytes4[] memory selectors) {
        selectors = new bytes4[](2);
        selectors[0] = bytes4(keccak256("setBudget(uint256,address,uint256,bytes)"));
        selectors[1] = bytes4(keccak256("fund(uint256,uint256,bytes)"));
    }

    /// @dev Register the owner once and record the budget; signal off-chain approvers.
    function _postSetBudget(
        uint256 jobId,
        address caller,
        address, /* token */
        uint256 amount,
        bytes memory optParams
    ) internal override {
        Job storage job = _jobs[jobId];
        job.budget = amount;

        if (job.owner == address(0)) {
            address owner;
            if (optParams.length >= 32) {
                owner = abi.decode(optParams, (address));
            }
            job.owner = owner != address(0) ? owner : caller;
        }

        emit ApprovalRequested(jobId, job.owner, caller, amount);
    }

    /// @dev Block funding unless a valid, unexpired owner signature is supplied.
    function _preFund(
        uint256 jobId,
        address, /* caller */
        bytes memory optParams
    ) internal view override {
        Job storage job = _jobs[jobId];

        address owner = job.owner;
        if (owner == address(0)) revert OwnerNotRegistered();

        (bytes memory signature, uint256 deadline) = abi.decode(optParams, (bytes, uint256));
        if (block.timestamp > deadline) revert ApprovalExpired();
        if (deadline > block.timestamp + MAX_APPROVAL_WINDOW) revert ApprovalWindowTooLong();

        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(APPROVAL_TYPEHASH, jobId, job.budget, deadline))
        );

        // Accepts both EOA (ECDSA) and smart-contract wallet (ERC-1271) owners.
        if (!SignatureChecker.isValidSignatureNow(owner, digest, signature)) revert InvalidApprovalSignature();
    }

    /// @notice Read the approval context for a job.
    function jobOf(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC8183HookMetadata).interfaceId || super.supportsInterface(interfaceId);
    }
}
