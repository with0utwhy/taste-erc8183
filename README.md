# Taste Gatekeeper Hook for ERC-8183

Human spending approval for autonomous AI agents. Built on [ERC-8183 Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183).

## What It Does

An `IACPHook` that blocks `fund()` until a designated human approves. Your agent creates jobs freely, but money doesn't move without your permission.

- Agent passes the approver's wallet address in `optParams`
- Only that address can call `approveJob()` -- fully trustless
- The contract admin (Taste) cannot approve or deny jobs
- Auto-approve threshold for small transactions
- Auto-deny timeout for unresponsive owners

## How It Works

```
1. Agent creates job with gatekeeper hook attached
2. Agent sets budget, passing owner address in optParams
3. Agent tries to fund() --> BLOCKED
4. Owner gets notified (Telegram / ntfy)
5. Owner reviews and approves via MetaMask
6. Agent retries fund() --> succeeds
```

## Agent Code

```solidity
// Create job with gatekeeper hook
uint256 jobId = ac.createJob(provider, evaluator, expiry, description, gatekeeperHook);

// Pass approver address in optParams
bytes memory optParams = abi.encode(ownerWallet);
ac.setBudget(jobId, amount, optParams);

// fund() will revert until ownerWallet calls approveJob()
// Agent listens for JobApproved event, then retries fund()
```

## Security

- `Ownable2Step` -- prevents accidental ownership transfer
- Per-job owner from `optParams` -- contract admin cannot approve/deny jobs
- Budget increase after approval resets approval status (prevents escalation attack)
- Job owner locked after first set (prevents owner swap attack)
- Configurable auto-deny timeout (constructor arg)
- Auto-approve threshold for small transactions (constructor arg)
- Audited with Semgrep `p/smart-contracts` -- 50 rules, 0 findings
- Payable constructors, nested ifs (gas optimized)

## Constructor

```solidity
constructor(
    address jobManager_,       // AgenticCommerce contract address
    address admin_,            // Hook admin (can change thresholds, NOT approve jobs)
    uint256 autoApproveBelow_, // Auto-approve threshold in token units (e.g. 5000000 = $5 USDC)
    uint256 denyTimeout_       // Auto-deny timeout in seconds (e.g. 1800 = 30 minutes)
)
```

## Deployed (Base Sepolia)

| Contract | Address |
|----------|---------|
| TasteGatekeeperHook | `0x61aa898Bf8b867D0901E4099585Fe20dce93e25C` |
| AgenticCommerce | `0x33eE7b991Df77266A33099C643aD9087457F8923` |

## One-Click Deploy

No Solidity knowledge needed. Deploy from the browser:

[humantaste.app/deploy-hooks](https://humantaste.app/deploy-hooks)

## Quick Start (Developers)

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Deploy (CLI)

```bash
cp .env.example .env
# Add DEPLOYER_PRIVATE_KEY and ERC8183_JOB_MANAGER_ADDRESS
npx hardhat run scripts/deploy.js --network baseSepolia
```

## Tests

```
TasteGatekeeperHook
  deployment
    sets jobManager, admin, and threshold
    supports IACPHook interface
  trustless ownership -- job owner from optParams
    extracts owner from setBudget optParams
    emits GatekeeperReviewRequested with jobOwner
    falls back to client if no owner in optParams
  gatekeeper flow -- trustless approval
    reverts fund() when pending
    job owner can approve
    job owner can deny
    admin (Taste) CANNOT approve jobs
    random address CANNOT approve jobs
  auto-approve threshold
    auto-approves jobs below threshold
    requires review for jobs at or above threshold
    admin can change threshold
  full lifecycle
    create -> setBudget -> (blocked) -> owner approves -> fund -> submit -> complete

15 passing
```

## Links

- [ERC-8183 Specification](https://eips.ethereum.org/EIPS/eip-8183)
- [Taste -- Human Judgment for the AI Economy](https://humantaste.app)
- [Deploy a Gatekeeper](https://humantaste.app/deploy-hooks)
- [Gatekeeper Approval Page](https://humantaste.app/gatekeeper)
- [ERC-8183 Builder Community](https://t.me/erc8183)

## License

MIT
