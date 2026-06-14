const { ethers, network } = require("hardhat");

// Read-only: prints the configured deployer address + balance on the selected
// network. No transactions. Used to confirm funding before a real deploy.
async function main() {
  const signers = await ethers.getSigners();
  if (!signers.length) {
    console.log(`[${network.name}] No deployer configured (DEPLOYER_PRIVATE_KEY unset)`);
    return;
  }
  const [deployer] = signers;
  const bal = await ethers.provider.getBalance(deployer.address);
  console.log(`[${network.name}] deployer: ${deployer.address}`);
  console.log(`[${network.name}] balance:  ${ethers.formatEther(bal)} ETH`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
