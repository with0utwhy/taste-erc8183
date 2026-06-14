// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ERC8183 (local minimal stand-in)
/// @notice Minimal local stand-in for the ERC-8183 core contract, used ONLY to
///         compile and unit-test hooks in this repository. This is NOT shipped in
///         any hook PR — the canonical core lives at
///         https://github.com/erc-8183/base-contracts. Only the members that
///         `BaseERC8183Hook` references (the `Job.hook` field and `getJob`) are
///         reproduced here; the real core is a full upgradeable escrow state machine.
contract ERC8183 {
    struct Job {
        address hook;
    }

    mapping(uint256 => Job) internal _jobs;

    function getJob(uint256 jobId) external view virtual returns (Job memory) {
        return _jobs[jobId];
    }
}
