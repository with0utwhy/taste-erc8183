const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Funds the demo job through the mock core. Fetches your relayed approval
// signature from the local server, packs it as the fund optParams, and calls
// the mock's fund → the hook's _preFund verifies the signature. If you approved
// in the GUI it succeeds; if not, it reverts (proving the gate).
//
//   DEMO_JOB_ID   = job id (default 1)
//   RELAY_BASE    = server base URL (default http://localhost:3001)
async function main() {
  const addrs = JSON.parse(fs.readFileSync(path.resolve(__dirname, ".demo-addrs.json"), "utf8"));
  const jobId = (process.env.DEMO_JOB_ID || "1");
  const base = process.env.RELAY_BASE || "http://localhost:3001";

  const url = `${base}/api/public/gatekeeper/approval/${addrs.hook}/${jobId}`;
  const res = await fetch(url);
  const json = await res.json();
  console.log("relay approval:", JSON.stringify(json.data));
  if (!json.success || json.data.status !== "approved" || !json.data.signature) {
    console.error(`\nNot approved yet (status=${json.data?.status}). Approve in the GUI first:`);
    console.error(`  http://localhost:5173/gatekeeper/${jobId}?hook=${addrs.hook}`);
    process.exit(1);
  }

  const optParams = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "uint256"],
    [json.data.signature, BigInt(json.data.deadline)],
  );

  const [deployer] = await ethers.getSigners();
  const core = await ethers.getContractAt("MockERC8183Core", addrs.core);

  console.log(`[${network.name}] funding job #${jobId} via mock core...`);
  const tx = await core.fund(addrs.hook, BigInt(jobId), deployer.address, optParams);
  await tx.wait();
  console.log("FUND SUCCEEDED — the hook accepted your signature. tx:", tx.hash);
}

main().catch((e) => {
  console.error("\nFUND REVERTED:", e.shortMessage || e.message);
  process.exitCode = 1;
});
