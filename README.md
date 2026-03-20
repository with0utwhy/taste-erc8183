# Taste Gatekeeper Hook for ERC-8183

Human spending approval for autonomous AI agents. Built on [ERC-8183 Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183).

## What It Does

An `IACPHook` that blocks `fund()` until a designated human approves. Your agent creates jobs freely, but money doesn't move without your permission.

- Agent passes the approver's wallet address in `optParams`
- Only that address can call `approveJob()` -- fully trustless
- The contract admin cannot approve or deny jobs
- Auto-approve threshold for small transactions
- Auto-deny timeout for unresponsive owners

## Getting Started

Two paths depending on your needs:

### Path A: Use the Shared Hook (No Deployment)

Use the existing hook deployed on Base Sepolia. No Solidity, no deployment, no gas costs.

**1. Configure your agent code:**

```solidity
// The shared gatekeeper hook on Base Sepolia
address gatekeeperHook = 0x61aa898Bf8b867D0901E4099585Fe20dce93e25C;

// Create job with gatekeeper attached
uint256 jobId = ac.createJob(provider, evaluator, expiry, description, gatekeeperHook);

// Pass YOUR wallet address as the approver in optParams
bytes memory optParams = abi.encode(yourWalletAddress);
ac.setBudget(jobId, amount, optParams);

// fund() will revert until you approve
// Listen for JobApproved event, then retry fund()
```

**2. Set up notifications:**

Go to [humantaste.app/gatekeeper](https://humantaste.app/gatekeeper), enter your wallet address, then:

- **Telegram:** Click "Connect via Telegram" -- auto-registers your wallet
- **ntfy:** Copy the topic and subscribe in the [ntfy app](https://ntfy.sh)

No wallet connection needed for notification setup.

**3. When your agent triggers the gatekeeper:**

- You receive a notification with job details (amount, description, parties)
- Tap the link to open the approval page
- Connect MetaMask and tap Approve or Deny
- Your agent detects the `JobApproved` event and retries `fund()`

### Path B: Deploy Your Own Hook

Deploy your own hook with custom auto-approve threshold and deny timeout.

**Option 1: One-click browser deploy (no Solidity):**

Go to [humantaste.app/deploy-hooks](https://humantaste.app/deploy-hooks), connect MetaMask, configure thresholds, click Deploy.

**Option 2: CLI deploy:**

```bash
git clone https://github.com/with0utwhy/taste-erc8183.git
cd taste-erc8183
npm install
cp .env.example .env
# Add DEPLOYER_PRIVATE_KEY and ERC8183_JOB_MANAGER_ADDRESS
npx hardhat run scripts/deploy.js --network baseSepolia
```

Then use the deployed address in your agent code and follow the same notification setup in step 2 above.

## How It Works

```
1. Agent creates job with gatekeeper hook attached
2. Agent sets budget, passing approver address in optParams
3. Agent tries to fund() --> BLOCKED by hook
4. Hook emits GatekeeperReviewRequested event
5. Off-chain service detects event, notifies approver (Telegram / ntfy)
6. Approver reviews job details and calls approveJob() via MetaMask
7. Agent detects JobApproved event, retries fund() --> succeeds
```

The agent handles the retry automatically by listening for the `JobApproved` event -- standard ERC-8183 event-driven pattern.

## Security

- `Ownable2Step` -- prevents accidental ownership transfer
- Per-job owner from `optParams` -- contract admin cannot approve/deny jobs
- Budget increase after approval resets approval status (prevents escalation)
- Job owner locked after first set (prevents owner swap)
- Configurable auto-deny timeout (default 30 min)
- Auto-approve threshold for small transactions
- Audited with Semgrep `p/smart-contracts` -- 50 rules, 0 findings

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
    admin CANNOT approve jobs
    random address CANNOT approve jobs
  auto-approve threshold
    auto-approves jobs below threshold
    requires review for jobs at or above threshold
  full lifecycle
    create -> setBudget -> (blocked) -> owner approves -> fund -> submit -> complete

14 passing
```

## Links

- [ERC-8183 Specification](https://eips.ethereum.org/EIPS/eip-8183)
- [Taste -- Human Judgment for the AI Economy](https://humantaste.app)
- [Deploy a Gatekeeper](https://humantaste.app/deploy-hooks)
- [Set Up Notifications](https://humantaste.app/gatekeeper)
- [ERC-8183 Builder Community](https://t.me/erc8183)

## License

MIT
