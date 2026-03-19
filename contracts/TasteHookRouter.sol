// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165.sol";
import "@openzeppelin/contracts/utils/introspection/ERC165Checker.sol";
import "./interfaces/IACPHook.sol";

/**
 * @title TasteHookRouter
 * @dev ERC-8183 hook that chains multiple sub-hooks on a single job.
 *
 * ERC-8183 allows one hook per job. This router IS that one hook, but
 * internally delegates to an ordered list of sub-hooks. Each sub-hook
 * is registered with the selectors it cares about.
 *
 * beforeAction: calls each matching sub-hook in order. If any reverts,
 * the entire action is blocked (standard hook behavior).
 *
 * afterAction: calls each matching sub-hook in order. If any reverts,
 * the entire transaction rolls back (standard hook behavior).
 *
 * Example: Route KYA screening on setProvider + Taste gatekeeper on fund
 * + Taste escalation on reject — all on the same job.
 *
 * The router owner manages the hook list. To change the combination,
 * deploy a new router with different hooks.
 */
contract TasteHookRouter is IACPHook, ERC165, Ownable2Step {

    // ── Types ──

    struct SubHook {
        address hook;
        bool allSelectors;    // If true, fires on every action
    }

    // ── State ──

    SubHook[] public subHooks;

    /// @dev selector → which sub-hook indexes care about it
    mapping(bytes4 => uint256[]) private _selectorToHooks;

    /// @dev The AgenticCommerce contract
    address public jobManager;

    // ── Events ──

    event SubHookAdded(address indexed hook, uint256 index, bool allSelectors);
    event SubHookRemoved(address indexed hook, uint256 index);

    // ── Errors ──

    error OnlyJobManager();
    error InvalidHook();
    error HookAlreadyAdded();
    error InvalidIndex();

    // ── Constructor ──

    constructor(address jobManager_, address owner_) payable Ownable(owner_) {
        jobManager = jobManager_;
    }

    // ── Admin: Manage Sub-Hooks ──

    /// @notice Add a sub-hook that fires on specific selectors
    /// @param hook The hook contract address (must implement IACPHook)
    /// @param selectors Function selectors this hook should fire on (empty = all)
    function addHook(address hook, bytes4[] calldata selectors) external onlyOwner {
        // Verify it implements IACPHook
        if (!ERC165Checker.supportsInterface(hook, type(IACPHook).interfaceId)) {
            revert InvalidHook();
        }

        // Check not already added
        for (uint256 i = 0; i < subHooks.length; i++) {
            if (subHooks[i].hook == hook) revert HookAlreadyAdded();
        }

        uint256 index = subHooks.length;
        bool allSelectors = selectors.length == 0;
        subHooks.push(SubHook({ hook: hook, allSelectors: allSelectors }));

        // Register selector mappings
        if (!allSelectors) {
            for (uint256 i = 0; i < selectors.length; i++) {
                _selectorToHooks[selectors[i]].push(index);
            }
        }

        emit SubHookAdded(hook, index, allSelectors);
    }

    /// @notice Remove the last sub-hook (pop from end to keep indexes simple)
    function removeLastHook() external onlyOwner {
        if (subHooks.length == 0) revert InvalidIndex();

        uint256 index = subHooks.length - 1;
        address hook = subHooks[index].hook;
        subHooks.pop();

        emit SubHookRemoved(hook, index);
    }

    /// @notice Get the number of sub-hooks
    function hookCount() external view returns (uint256) {
        return subHooks.length;
    }

    /// @notice Get all sub-hook addresses
    function getHooks() external view returns (address[] memory) {
        address[] memory hooks = new address[](subHooks.length);
        for (uint256 i = 0; i < subHooks.length; i++) {
            hooks[i] = subHooks[i].hook;
        }
        return hooks;
    }

    // ── IACPHook ──

    function beforeAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        if (msg.sender != jobManager) revert OnlyJobManager();

        for (uint256 i = 0; i < subHooks.length; i++) {
            if (_shouldFire(i, selector)) {
                IACPHook(subHooks[i].hook).beforeAction(jobId, selector, data);
            }
        }
    }

    function afterAction(uint256 jobId, bytes4 selector, bytes calldata data) external override {
        if (msg.sender != jobManager) revert OnlyJobManager();

        for (uint256 i = 0; i < subHooks.length; i++) {
            if (_shouldFire(i, selector)) {
                IACPHook(subHooks[i].hook).afterAction(jobId, selector, data);
            }
        }
    }

    // ── Internal ──

    function _shouldFire(uint256 hookIndex, bytes4 selector) internal view returns (bool) {
        if (subHooks[hookIndex].allSelectors) return true;

        uint256[] storage hookIndexes = _selectorToHooks[selector];
        for (uint256 i = 0; i < hookIndexes.length; i++) {
            if (hookIndexes[i] == hookIndex) return true;
        }
        return false;
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
