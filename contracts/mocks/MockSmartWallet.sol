// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title MockSmartWallet
/// @notice Minimal ERC-1271 wallet for tests: validates a signature by recovering
///         it to a configured EOA signer. Lets the OwnerApprovalHook tests prove
///         the smart-contract-wallet owner path. Not shipped in any hook PR.
contract MockSmartWallet {
    address public immutable signer;
    bytes4 private constant MAGIC = 0x1626ba7e; // ERC-1271 isValidSignature.selector

    constructor(address signer_) {
        signer = signer_;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        return ECDSA.recover(hash, signature) == signer ? MAGIC : bytes4(0);
    }
}
