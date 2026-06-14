// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {BaseERC8183Hook} from "../BaseERC8183Hook.sol";
import {IERC8183HookMetadata} from "../interfaces/IERC8183HookMetadata.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title OwnerApprovalHook
/// @notice Profile A policy hook: a job cannot be funded until a designated
///         owner has approved its budget out-of-band. Approval is presented as
///         a signature over the job's terms, supplied in `fund` optParams — the
///         hook holds no approval state of its own and exposes no mutating
///         functions outside the ERC-8183 callbacks.
/// @dev    Flow:
///           1. The owner address is registered once, from `setBudget` optParams
///              (`abi.encode(owner)`); falls back to the caller if none is given.
///              An `ApprovalRequested` event signals an off-chain approver.
///           2. The owner signs the job terms off-chain (no gas):
///              digest = keccak256(abi.encode(block.chainid, address(this), jobId, budget, deadline)),
///              wrapped as an EIP-191 personal-sign message.
///           3. `fund` optParams carry `abi.encode(signature, deadline)`. The hook
///              recovers the signer and requires it to equal the registered owner
///              and the deadline to be in the future. A mismatching or missing
///              signature reverts, blocking the funding.
///
///         Denial needs no transaction: an unsigned job can never be funded, and
///         the deadline bounds each signature. Raising the budget via a later
///         `setBudget` changes the signed digest, so a prior approval no longer
///         validates — re-approval is required. Every funded job therefore
///         carries an owner signature; there is no unattested funding path.
contract OwnerApprovalHook is BaseERC8183Hook, IERC8183HookMetadata {
    using MessageHashUtils for bytes32;

    /// @notice Per-job approval context.
    struct Job {
        address owner; // the only address whose signature can approve this job
        uint256 budget; // last budget seen at setBudget; bound into the signed digest
    }

    mapping(uint256 => Job) private _jobs;

    /// @notice Emitted when a job is registered and awaiting owner approval.
    event ApprovalRequested(uint256 indexed jobId, address indexed owner, address indexed client, uint256 budget);

    error OwnerNotRegistered();
    error ApprovalExpired();
    error InvalidApprovalSignature();

    /// @param erc8183Contract_ The ERC-8183 core contract (or MultiHookRouter) authorized to call this hook.
    constructor(address erc8183Contract_) BaseERC8183Hook(erc8183Contract_) {}

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

        bytes32 digest = keccak256(
            abi.encode(block.chainid, address(this), jobId, job.budget, deadline)
        ).toEthSignedMessageHash();

        if (ECDSA.recover(digest, signature) != owner) revert InvalidApprovalSignature();
    }

    /// @notice Read the approval context for a job.
    function jobOf(uint256 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        return interfaceId == type(IERC8183HookMetadata).interfaceId || super.supportsInterface(interfaceId);
    }
}
