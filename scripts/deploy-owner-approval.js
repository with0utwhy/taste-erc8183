const { ethers, network } = require("hardhat");

// Deploys the conformant OwnerApprovalHook (Profile A). Single constructor arg:
// the ERC-8183 core contract authorized to call the hook callbacks.
//
//   base         → AgenticCommerceV3 (canonical mainnet core)
//   baseSepolia  → AgenticCommerce testnet core (per taste-erc8183 README)
//
// Both addresses are verified live (getCode + getJob) on their network. The
// .env ERC8183_JOB_MANAGER_ADDRESS is the mainnet core, so it is NOT used for
// the Sepolia branch (it has no code there).
//
// Guards: refuses to deploy if the deployer is unfunded or if the core address
// has no code (a wrong immutable core would permanently brick the hook).
const CORE_BY_NETWORK = {
  base: "0x238E541BfefD82238730D00a2208E5497F1832E0",
  baseSepolia: "0x33eE7b991Df77266A33099C643aD9087457F8923",
};

async function main() {
  const core = CORE_BY_NETWORK[network.name];
  if (!core) {
    console.error(`No ERC-8183 core configured for network "${network.name}".`);
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(bal)} ETH`);
  console.log(`Core:     ${core}`);

  if (bal === 0n) {
    console.error("Deployer has 0 ETH — fund it before deploying.");
    process.exit(1);
  }

  const code = await ethers.provider.getCode(core);
  if (code === "0x") {
    console.error(`No contract code at core ${core} on ${network.name} — refusing to deploy.`);
    process.exit(1);
  }
  console.log(`Core code: ${(code.length - 2) / 2} bytes — OK\n`);

  console.log("Deploying OwnerApprovalHook...");
  const Hook = await ethers.getContractFactory("OwnerApprovalHook");
  const hook = await Hook.deploy(core);
  await hook.waitForDeployment();
  const addr = await hook.getAddress();

  console.log("\nDeployed!");
  console.log(`  Address: ${addr}`);
  console.log(`  Core:    ${core}`);
  console.log("\nVerify:");
  console.log(`  npx hardhat verify --network ${network.name} ${addr} ${core}`);
  console.log("\nWhitelisting (Virtuals admin / PR to erc-8183/hook-contracts):");
  console.log(`  setHookWhitelist("${addr}", true)`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
