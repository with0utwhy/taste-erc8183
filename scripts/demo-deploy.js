const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Path-B local demo: deploy a MockERC8183Core (acts as the ERC-8183 core that
// drives the hook callbacks) plus a fresh OwnerApprovalHook bound to that mock.
// This lets us drive the FULL setBudget → approve → fund loop on Sepolia with no
// dependency on Virtuals whitelisting the canonical core. Addresses are written
// to scripts/.demo-addrs.json for the setbudget/fund driver scripts.
async function main() {
  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}  (${ethers.formatEther(bal)} ETH)`);
  if (bal === 0n) { console.error("Deployer unfunded."); process.exit(1); }

  console.log("\nDeploying MockERC8183Core...");
  const Core = await ethers.getContractFactory("MockERC8183Core");
  const core = await Core.deploy();
  await core.waitForDeployment();
  const coreAddr = await core.getAddress();
  console.log("  MockERC8183Core:", coreAddr);

  console.log("\nDeploying OwnerApprovalHook (bound to mock core)...");
  const Hook = await ethers.getContractFactory("OwnerApprovalHook");
  const hook = await Hook.deploy(coreAddr);
  await hook.waitForDeployment();
  const hookAddr = await hook.getAddress();
  console.log("  OwnerApprovalHook:", hookAddr);

  const out = { network: network.name, core: coreAddr, hook: hookAddr };
  const file = path.resolve(__dirname, ".demo-addrs.json");
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log("\nSaved:", file);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
