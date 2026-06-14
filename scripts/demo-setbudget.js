const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Registers a demo job in the mock-bound OwnerApprovalHook: calls the mock core's
// setBudget, which fires the hook's afterAction → records the owner (your wallet,
// from DEMO_OWNER) + budget and emits ApprovalRequested. After this, jobOf(jobId)
// returns your wallet as owner, so the GUI has something to sign.
//
//   DEMO_OWNER   = the wallet that will approve in MetaMask (required)
//   DEMO_JOB_ID  = job id (default 1)
//   DEMO_AMOUNT  = budget in USDC base units, 6 decimals (default 1000000 = $1)
async function main() {
  const addrs = JSON.parse(fs.readFileSync(path.resolve(__dirname, ".demo-addrs.json"), "utf8"));
  const owner = process.env.DEMO_OWNER;
  if (!owner || !/^0x[0-9a-fA-F]{40}$/.test(owner)) {
    console.error("Set DEMO_OWNER to your wallet address (0x...).");
    process.exit(1);
  }
  const jobId = BigInt(process.env.DEMO_JOB_ID || "1");
  const amount = BigInt(process.env.DEMO_AMOUNT || "1000000");
  const TOKEN = "0x000000000000000000000000000000000000dEaD"; // placeholder USDC

  const [deployer] = await ethers.getSigners();
  const core = await ethers.getContractAt("MockERC8183Core", addrs.core);
  const hook = await ethers.getContractAt("OwnerApprovalHook", addrs.hook);

  console.log(`[${network.name}] core ${addrs.core} / hook ${addrs.hook}`);
  console.log(`Registering job #${jobId}: owner=${owner}, budget=${amount} (client=${deployer.address})`);

  const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner]);
  const tx = await core.setBudget(addrs.hook, jobId, deployer.address, TOKEN, amount, optParams);
  await tx.wait();
  console.log("setBudget tx:", tx.hash);

  const job = await hook.jobOf(jobId);
  console.log("jobOf =>", { owner: job.owner, budget: job.budget.toString() });
  console.log(`\nNow open: http://localhost:5173/gatekeeper/${jobId}?hook=${addrs.hook}`);
  console.log("Connect that wallet, click Approve, then run demo-fund.js.");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
