// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "./interfaces/IACPHook.sol";

/**
 * @title TasteGatekeeperHook
 * @dev ERC-8183 hook that requires human approval before a job can be funded.
 * Fully trustless — the agent passes the approver's address in optParams,
 * and only that address can approve or deny. Taste is notification-only.
 *
 * Flow:
 * 1. Agent creates job with this hook, passing optParams=abi.encode(ownerAddress)
 * 2. Agent sets budget — hook registers the job + owner, emits event
 * 3. Taste server detects event → notifies owner via ntfy/push
 * 4. Agent tries fund() → hook reverts with "Awaiting human approval"
 * 5. Owner opens MetaMask → calls approveJob(jobId) directly on this contract
 * 6. Agent retries fund() → passes → job proceeds
 *
 * The contract owner (Taste) can set the auto-approve threshold but CANNOT
 * approve or deny individual jobs. Only the per-job owner can do that.
 */
contract TasteGatekeeperHook is IACPHook, ERC165, Ownable2Step {

    // ── Events ──

    event GatekeeperReviewRequested(
        uint256 indexed jobId,
        address indexed jobOwner,
        address indexed client,
        uint256 budget
    );

    event JobApproved(uint256 indexed jobId, address indexed approver, string reason);
    event JobDenied(uint256 indexed jobId, address indexed denier, string reason);

    // ── State ──

    enum ApprovalStatus { Pending, Approved, Denied }

    struct Review {
        ApprovalStatus status;
        uint256 budget;
        address client;
        address jobOwner;     // The person who can approve/deny THIS job
        string reason;
        uint256 reviewedAt;
    }

    mapping(uint256 => Review) public reviews;

    /// @dev The AgenticCommerce contract
    address public jobManager;

    /// @dev Jobs under this budget (in token units) are auto-approved. 0 = all need review.
    uint256 public autoApproveBelow;

    // ── Errors ──

    error OnlyJobManager();
    error OnlyJobOwner();
    error AwaitingHumanApproval();
    error JobDeniedByHuman();
    error NotPending();
    error NoOwnerSpecified();

    // ── Constructor ──

    constructor(address jobManager_, address admin_, uint256 autoApproveBelow_) payable Ownable(admin_) {
        jobManager = jobManager_;
        autoApproveBelow = autoApproveBelow_;
    }

    // ── Admin (Taste — only threshold management, NOT job approval) ──

    function setAutoApproveBelow(uint256 threshold) external onlyOwner {
        autoApproveBelow = threshold;
    }

    // ── IACPHook ──

    /// @dev beforeAction — gate fund() until the job's owner approves
    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata) external view override {
        if (msg.sender != jobManager) revert OnlyJobManager();

        // Only gate fund()
        if (selector != bytes4(keccak256("fund(uint256,bytes)"))) {
            return;
        }

        Review storage review = reviews[jobId];

        if (review.status == ApprovalStatus.Approved) return;
        if (review.status == ApprovalStatus.Denied) revert JobDeniedByHuman();

        // Pending — must have budget registered (from setBudget)
        if (review.status == ApprovalStatus.Pending) {
            if (review.budget > 0) {
                revert AwaitingHumanApproval();
            }
        }

        // Not yet registered via setBudget
        revert AwaitingHumanApproval();
    }

    /// @dev afterAction — extract owner from optParams, track budgets, emit events
    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        if (msg.sender != jobManager) revert OnlyJobManager();

        // On setBudget: extract owner from optParams, register job
        if (selector == bytes4(keccak256("setBudget(uint256,uint256,bytes)"))) {
            (address caller, uint256 amount, bytes memory optParams) = abi.decode(data, (address, uint256, bytes));

            Review storage review = reviews[jobId];
            review.budget = amount;
            review.client = caller;

            // Extract job owner from optParams (agent passes abi.encode(ownerAddress))
            if (optParams.length >= 32) {
                address jobOwner = abi.decode(optParams, (address));
                if (jobOwner != address(0)) {
                    review.jobOwner = jobOwner;
                }
            }

            // Auto-approve small jobs
            if (autoApproveBelow > 0) {
                if (amount < autoApproveBelow) {
                    review.status = ApprovalStatus.Approved;
                    review.reason = "Auto-approved: below threshold";
                    review.reviewedAt = block.timestamp;
                    emit JobApproved(jobId, address(0), "Auto-approved: below threshold");
                    return;
                }
            }

            // If no owner specified, use the client as fallback
            if (review.jobOwner == address(0)) {
                review.jobOwner = caller;
            }

            emit GatekeeperReviewRequested(jobId, review.jobOwner, caller, amount);
        }

        // On createJob: capture client as fallback owner
        if (selector == bytes4(keccak256("createJob(address,address,uint256,string,address)"))) {
            (address client, , ) = abi.decode(data, (address, address, address));
            if (reviews[jobId].jobOwner == address(0)) {
                reviews[jobId].client = client;
            }
        }
    }

    // ── Approval (called by the job's owner directly via MetaMask) ──

    function approveJob(uint256 jobId, string calldata reason) external {
        Review storage review = reviews[jobId];
        if (review.status != ApprovalStatus.Pending) revert NotPending();
        if (msg.sender != review.jobOwner) revert OnlyJobOwner();

        review.status = ApprovalStatus.Approved;
        review.reason = reason;
        review.reviewedAt = block.timestamp;

        emit JobApproved(jobId, msg.sender, reason);
    }

    function denyJob(uint256 jobId, string calldata reason) external {
        Review storage review = reviews[jobId];
        if (review.status != ApprovalStatus.Pending) revert NotPending();
        if (msg.sender != review.jobOwner) revert OnlyJobOwner();

        review.status = ApprovalStatus.Denied;
        review.reason = reason;
        review.reviewedAt = block.timestamp;

        emit JobDenied(jobId, msg.sender, reason);
    }

    // ── Views ──

    function getReview(uint256 jobId) external view returns (Review memory) {
        return reviews[jobId];
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
