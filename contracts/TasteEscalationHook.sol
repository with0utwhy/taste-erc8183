// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./interfaces/IACPHook.sol";

/**
 * @title TasteEscalationHook
 * @dev ERC-8183 hook that routes jobs to Taste for human judgment. Two triggers:
 *
 * 1. AUTOMATIC: After a reject() call, the hook emits EscalationRequested. Taste's
 *    server picks it up, routes to a human expert, records the verdict on-chain.
 *
 * 2. VOLUNTARY: Any evaluator attached to a hooked job can call requestReview()
 *    when they're unsure about a subjective judgment. "I'm an AI evaluator and I
 *    can't tell if this creative brief was fulfilled — let a human decide."
 *
 * Both paths produce the same on-chain record: a human-reviewed verdict with
 * reasoning, resolved via resolveEscalation().
 */
contract TasteEscalationHook is IACPHook, ERC165, Ownable2Step {

    // ── Events ──

    event EscalationRequested(
        uint256 indexed jobId,
        address indexed requester,
        bytes32 reason,
        EscalationTrigger trigger
    );

    event EscalationResolved(
        uint256 indexed jobId,
        bool approved,
        string verdict
    );

    enum EscalationTrigger { Rejection, EvaluatorRequest }

    // ── State ──

    enum EscalationStatus { None, Pending, ResolvedApproved, ResolvedRejected }

    struct Escalation {
        EscalationStatus status;
        EscalationTrigger trigger;
        address requester;
        bytes32 originalReason;
        string verdict;
        uint256 resolvedAt;
    }

    mapping(uint256 => Escalation) public escalations;

    /// @dev The AgenticCommerce contract that calls our hooks
    address public jobManager;

    // ── Errors ──

    error OnlyJobManager();
    error NotPending();
    error AlreadyEscalated();
    error JobNotSubmitted();

    // ── Constructor ──

    constructor(address jobManager_, address owner_) payable Ownable(owner_) {
        jobManager = jobManager_;
    }

    // ── IACPHook ──

    /// @dev beforeAction is a no-op — we don't gate any transitions
    function beforeAction(uint256, bytes4, bytes calldata) external view override {
        if (msg.sender != jobManager) revert OnlyJobManager();
    }

    /// @dev afterAction — detect reject() and emit escalation event
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        if (msg.sender != jobManager) revert OnlyJobManager();

        // reject(uint256,bytes32,bytes) selector = 0x490cc8a4
        // We match by checking the selector matches reject's signature
        if (selector != bytes4(keccak256("reject(uint256,bytes32,bytes)"))) {
            return; // Not a rejection — ignore
        }

        if (escalations[jobId].status != EscalationStatus.None) revert AlreadyEscalated();

        // Decode: abi.encode(caller, reason, optParams)
        (address caller, bytes32 reason, ) = abi.decode(data, (address, bytes32, bytes));

        escalations[jobId] = Escalation({
            status: EscalationStatus.Pending,
            trigger: EscalationTrigger.Rejection,
            requester: caller,
            originalReason: reason,
            verdict: "",
            resolvedAt: 0
        });

        emit EscalationRequested(jobId, caller, reason, EscalationTrigger.Rejection);
    }

    // ── Voluntary Review (called by evaluators who want human help) ──

    /// @dev An evaluator can call this when they're unsure about a subjective judgment.
    /// The job must be in Submitted state (provider has delivered, evaluator hasn't decided).
    /// Anyone can call this — Taste's server validates that the caller is the job's evaluator.
    function requestReview(uint256 jobId, bytes32 reason) external {
        if (escalations[jobId].status != EscalationStatus.None) revert AlreadyEscalated();

        escalations[jobId] = Escalation({
            status: EscalationStatus.Pending,
            trigger: EscalationTrigger.EvaluatorRequest,
            requester: msg.sender,
            originalReason: reason,
            verdict: "",
            resolvedAt: 0
        });

        emit EscalationRequested(jobId, msg.sender, reason, EscalationTrigger.EvaluatorRequest);
    }

    // ── Resolution (called by Taste server) ──

    /// @dev Taste's server calls this after a human expert reviews the dispute
    function resolveEscalation(
        uint256 jobId,
        bool approved,
        string calldata verdict
    ) external onlyOwner {
        Escalation storage esc = escalations[jobId];
        if (esc.status != EscalationStatus.Pending) revert NotPending();

        esc.status = approved ? EscalationStatus.ResolvedApproved : EscalationStatus.ResolvedRejected;
        esc.verdict = verdict;
        esc.resolvedAt = block.timestamp;

        emit EscalationResolved(jobId, approved, verdict);
    }

    // ── Views ──

    function getEscalation(uint256 jobId) external view returns (Escalation memory) {
        return escalations[jobId];
    }

    // ── ERC165 ──

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC165, IERC165)
        returns (bool)
    {
        return interfaceId == type(IACPHook).interfaceId || super.supportsInterface(interfaceId);
    }
}
