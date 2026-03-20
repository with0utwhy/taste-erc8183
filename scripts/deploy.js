const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH\n");

  const JOB_MANAGER = process.env.ERC8183_JOB_MANAGER_ADDRESS;
  if (!JOB_MANAGER) {
    console.error("Set ERC8183_JOB_MANAGER_ADDRESS in .env");
    process.exit(1);
  }

  const autoApproveBelow = 5_000_000n; // 5 USDC (6 decimals)
  const denyTimeout = 1800n; // 30 minutes

  console.log("Deploying TasteGatekeeperHook...");
  const GK = await ethers.getContractFactory("TasteGatekeeperHook");
  const gk = await GK.deploy(JOB_MANAGER, deployer.address, autoApproveBelow, denyTimeout);
  await gk.waitForDeployment();
  const addr = await gk.getAddress();

  console.log("\nDeployed!");
  console.log("  Address:", addr);
  console.log("  Owner:", deployer.address);
  console.log("  Auto-approve below: $5 USDC");
  console.log("  Auto-deny timeout: 30 minutes");
  console.log("\nAsk the AgenticCommerce admin to whitelist:");
  console.log(`  setHookWhitelist("${addr}", true)`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
