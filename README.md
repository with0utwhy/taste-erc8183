# Taste ERC-8183 Hooks

Human judgment as on-chain infrastructure for [ERC-8183 Agentic Commerce](https://eips.ethereum.org/EIPS/eip-8183).

Five contracts that plug into the ERC-8183 job lifecycle, adding human oversight to autonomous agent transactions.

## Contracts

### TasteGatekeeperHook

**Human spending approval for autonomous agents.**

An `IACPHook` that blocks `fund()` until a designated human approves. The agent passes the approver's address in `optParams` — only that address can call `approveJob()`. Fully trustless: Taste (the contract admin) cannot approve or deny jobs.

- `beforeAction(fund)` — reverts with `AwaitingHumanApproval` until approved
- `afterAction(setBudget)` — extracts approver from `optParams`, emits `GatekeeperReviewRequested`
- Auto-approve threshold for small transactions (configurable)

```solidity
// Agent code: create job with gatekeeper hook
uint256 jobId = ac.createJob(provider, evaluator, expiry, description, gatekeeperHook);

// Pass approver address in optParams
ac.setBudget(jobId, amount, abi.encode(ownerWallet));

// fund() will revert until ownerWallet calls approveJob()
// Agent listens for JobApproved event, then retries fund()
```

### TasteEscalationHook

**Dispute resolution with human arbitration.**

An `IACPHook` that fires after `reject()`, creating an on-chain record that the dispute was escalated to a human expert. Also supports voluntary escalation — an AI evaluator that's unsure can call `requestReview()` to get a human second opinion.

- `afterAction(reject)` — emits `EscalationRequested`, records the dispute
- `requestReview(jobId, reason)` — voluntary escalation by evaluators
- `resolveEscalation(jobId, approved, verdict)` — human verdict recorded on-chain

### TasteContentCertificate

**On-chain proof of human content review.**

A registry that records which content has been reviewed and approved by a human expert. Content is identified by `keccak256` hash — the actual content never goes on-chain. Anyone can verify by calling `verify(contentHash)`.

- `issue(contentHash, agent, offeringType, verdict, domain)` — record a review
- `verify(contentHash)` — check if content was human-reviewed
- Revocable if content is later found problematic
- EU AI Act compliance: documented human review with immutable audit trail

### TasteBadge

**Soulbound reputation badge for agents.**

A non-transferable ERC-721 that attests an agent consistently passes human evaluation in a specific domain. One badge per agent per domain.

- `mint(agent, domain, evaluationCount, approvalCount)` — issue badge
- `getAttestation(agent, domain)` — public verification
- `revoke(tokenId)` — remove if quality degrades

### TasteHookRouter

**Chain multiple hooks on a single job.**

ERC-8183 allows one hook per job. The router IS that one hook, but internally delegates to an ordered list of sub-hooks. Each sub-hook is registered with the selectors it cares about — so you can combine a gatekeeper (on `fund`), an escalation hook (on `reject`), and any third-party hook on the same job.

- `addHook(address, selectors)` — add a sub-hook (empty selectors = fire on all actions)
- `removeLastHook()` — remove the last sub-hook
- `getHooks()` — list all registered sub-hooks
- ERC-165 verification — rejects contracts that don't implement `IACPHook`

```solidity
// Deploy router
TasteHookRouter router = new TasteHookRouter(agenticCommerce, owner);

// Add gatekeeper on fund + setBudget
router.addHook(gatekeeperHook, [fundSelector, setBudgetSelector]);

// Add escalation on reject
router.addHook(escalationHook, [rejectSelector]);

// Agent uses router as its single hook
ac.createJob(provider, evaluator, expiry, description, address(router));
```

**Important:** Sub-hooks must have their `jobManager` set to the router address (not AgenticCommerce), because the router is the contract calling them.

## Deployed Addresses (Base Sepolia)

| Contract | Address |
|----------|---------|
| TasteGatekeeperHook | `0x61aa898Bf8b867D0901E4099585Fe20dce93e25C` |
| TasteEscalationHook | `0xb96bFC120eeF78b96341167190138Aa88198052B` |
| TasteContentCertificate | `0xbD4dDF95C63F90671F17AC670Aa127d54cC5fE5a` |
| TasteBadge | `0x0394164dEdD964c5bC80a869EFDb6682F6bA2304` |

Used with AgenticCommerce at `0x33eE7b991Df77266A33099C643aD9087457F8923` (Base Sepolia).

## How It Works

```
Agent creates job with hook attached
  |
  |-- Gatekeeper: blocks fund() until human approves
  |-- Escalation: records dispute after reject(), routes to human
  |
Agent or evaluator completes the job
  |
  |-- Content Certificate: on-chain proof of human review
  |-- Badge: soulbound reputation after consistent approvals
```

All hooks implement `IACPHook` and are fully compatible with any ERC-8183 `AgenticCommerce` deployment.

## Security

- All contracts use `Ownable2Step` (prevents accidental ownership transfer)
- 69 tests covering access control, trustless ownership, auto-approve, hook routing, and full lifecycle
- Audited with Semgrep `p/smart-contracts` — 50 rules, 0 findings
- Gatekeeper: per-job owner from `optParams` — contract admin cannot approve/deny jobs
- Escalation: `onlyJobManager` enforced on hook callbacks

## Quick Start

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Deploy

```bash
cp .env.example .env
# Add DEPLOYER_PRIVATE_KEY to .env
npx hardhat run scripts/deploy.js --network baseSepolia
```

## Links

- [ERC-8183 Specification](https://eips.ethereum.org/EIPS/eip-8183)
- [ERC-8183 Reference Implementation](https://github.com/erc-8183/base-contracts)
- [Taste — Human Judgment for the AI Economy](https://humantaste.app)
- [Taste Whitepaper](https://humantaste.app/whitepaper)
- [ERC-8183 Builder Community](https://t.me/erc8183)

## License

MIT
