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

  // TasteGatekeeperHook
  console.log("Deploying TasteGatekeeperHook...");
  const autoApproveBelow = 5_000_000n; // 5 USDC (6 decimals)
  const GK = await ethers.getContractFactory("TasteGatekeeperHook");
  const gk = await GK.deploy(JOB_MANAGER, deployer.address, autoApproveBelow);
  await gk.waitForDeployment();
  console.log("  TasteGatekeeperHook:", await gk.getAddress());

  // TasteEscalationHook
  console.log("Deploying TasteEscalationHook...");
  const Hook = await ethers.getContractFactory("TasteEscalationHook");
  const hook = await Hook.deploy(JOB_MANAGER, deployer.address);
  await hook.waitForDeployment();
  console.log("  TasteEscalationHook:", await hook.getAddress());

  // TasteContentCertificate
  console.log("Deploying TasteContentCertificate...");
  const Cert = await ethers.getContractFactory("TasteContentCertificate");
  const cert = await Cert.deploy(deployer.address);
  await cert.waitForDeployment();
  console.log("  TasteContentCertificate:", await cert.getAddress());

  // TasteBadge
  console.log("Deploying TasteBadge...");
  const Badge = await ethers.getContractFactory("TasteBadge");
  const badge = await Badge.deploy(deployer.address);
  await badge.waitForDeployment();
  console.log("  TasteBadge:", await badge.getAddress());

  console.log("\nDone! Ask the AgenticCommerce admin to whitelist the hooks.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
