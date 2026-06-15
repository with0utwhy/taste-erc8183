// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC8183Hook} from "../erc8183/IERC8183Hook.sol";
import {ERC8183} from "../erc8183/ERC8183.sol";

/// @title MockERC8183Core
/// @notice Test-only driver that plays the ERC-8183 core's role: it is the
///         authorized caller (`erc8183Contract`) and invokes hook callbacks with
///         the same `data` encodings the real core produces per selector. Inherits
///         the minimal core stand-in so it also answers `getJob` (used by the
///         hook's router-path access check). Not shipped in any hook PR.
contract MockERC8183Core is ERC8183 {
    bytes4 public constant SEL_SET_BUDGET = bytes4(keccak256("setBudget(uint256,address,uint256,bytes)"));
    bytes4 public constant SEL_FUND = bytes4(keccak256("fund(uint256,uint256,bytes)"));

    /// @dev Mirrors the core's `_afterHook` for setBudget: data = abi.encode(caller, token, amount, optParams).
    function setBudget(
        address hook,
        uint256 jobId,
        address caller,
        address token,
        uint256 amount,
        bytes calldata optParams
    ) external {
        IERC8183Hook(hook).afterAction(jobId, SEL_SET_BUDGET, abi.encode(caller, token, amount, optParams));
    }

    /// @dev Mirrors the core's fund: pre-hook (gate) then post-hook (consume),
    ///      both with data = abi.encode(caller, optParams), as the real core does.
    function fund(address hook, uint256 jobId, address caller, bytes calldata optParams) external {
        bytes memory data = abi.encode(caller, optParams);
        IERC8183Hook(hook).beforeAction(jobId, SEL_FUND, data);
        IERC8183Hook(hook).afterAction(jobId, SEL_FUND, data);
    }
}
