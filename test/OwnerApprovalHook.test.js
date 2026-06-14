const { expect } = require("chai");
const { ethers } = require("hardhat");

// OwnerApprovalHook — conformant ERC-8183 Profile-A hook. Approval is an
// off-chain EIP-191 signature over the job terms, presented in fund optParams.
describe("OwnerApprovalHook", function () {
  const JOB = 1n;
  const AMOUNT = 1000n;
  const TOKEN = "0x000000000000000000000000000000000000dEaD";
  const FUTURE = 9_999_999_999n; // year 2286
  const PAST = 1n;

  const coder = ethers.AbiCoder.defaultAbiCoder();
  const SEL_SET_BUDGET = ethers.id("setBudget(uint256,address,uint256,bytes)").slice(0, 10);
  const SEL_FUND = ethers.id("fund(uint256,uint256,bytes)").slice(0, 10);
  const METADATA_IID = ethers.id("requiredSelectors()").slice(0, 10);

  let core, hook, hookAddr, chainId;
  let deployer, owner, client, stranger;

  // Mirror the hook's digest: keccak256(abi.encode(chainid,this,jobId,budget,deadline)),
  // signed as an EIP-191 personal message.
  async function signApproval(signer, jobId, budget, deadline) {
    const inner = ethers.keccak256(
      coder.encode(
        ["uint256", "address", "uint256", "uint256", "uint256"],
        [chainId, hookAddr, jobId, budget, deadline]
      )
    );
    return signer.signMessage(ethers.getBytes(inner));
  }

  const ownerParams = (addr) => coder.encode(["address"], [addr]);
  const fundParams = (sig, deadline) => coder.encode(["bytes", "uint256"], [sig, deadline]);

  beforeEach(async function () {
    [deployer, owner, client, stranger] = await ethers.getSigners();
    core = await (await ethers.getContractFactory("MockERC8183Core")).deploy();
    hook = await (await ethers.getContractFactory("OwnerApprovalHook")).deploy(await core.getAddress());
    hookAddr = await hook.getAddress();
    chainId = (await ethers.provider.getNetwork()).chainId;
  });

  describe("deployment & metadata", function () {
    it("requiredSelectors returns setBudget + fund", async function () {
      const sels = await hook.requiredSelectors();
      expect(sels).to.deep.equal([SEL_SET_BUDGET, SEL_FUND]);
    });

    it("advertises ERC165 + IERC8183HookMetadata, not 0xffffffff", async function () {
      expect(await hook.supportsInterface("0x01ffc9a7")).to.equal(true);
      expect(await hook.supportsInterface(METADATA_IID)).to.equal(true);
      expect(await hook.supportsInterface("0xffffffff")).to.equal(false);
    });
  });

  describe("owner registration (setBudget)", function () {
    it("registers the owner from optParams and emits ApprovalRequested", async function () {
      await expect(core.setBudget(hookAddr, JOB, client.address, TOKEN, AMOUNT, ownerParams(owner.address)))
        .to.emit(hook, "ApprovalRequested")
        .withArgs(JOB, owner.address, client.address, AMOUNT);
      const job = await hook.jobOf(JOB);
      expect(job.owner).to.equal(owner.address);
      expect(job.budget).to.equal(AMOUNT);
    });

    it("falls back to the caller when no owner is supplied", async function () {
      await core.setBudget(hookAddr, JOB, client.address, TOKEN, AMOUNT, "0x");
      expect((await hook.jobOf(JOB)).owner).to.equal(client.address);
    });

    it("sets the owner only once (no swap after registration)", async function () {
      await core.setBudget(hookAddr, JOB, client.address, TOKEN, AMOUNT, ownerParams(owner.address));
      await core.setBudget(hookAddr, JOB, client.address, TOKEN, 2000n, ownerParams(stranger.address));
      const job = await hook.jobOf(JOB);
      expect(job.owner).to.equal(owner.address); // unchanged
      expect(job.budget).to.equal(2000n); // budget still tracks latest
    });
  });

  describe("funding gate (fund)", function () {
    beforeEach(async function () {
      await core.setBudget(hookAddr, JOB, client.address, TOKEN, AMOUNT, ownerParams(owner.address));
    });

    it("allows funding with a valid owner signature", async function () {
      const sig = await signApproval(owner, JOB, AMOUNT, FUTURE);
      await expect(core.fund(hookAddr, JOB, client.address, fundParams(sig, FUTURE))).to.not.be.reverted;
    });

    it("reverts when the job owner was never registered", async function () {
      const sig = await signApproval(owner, 2n, AMOUNT, FUTURE);
      await expect(core.fund(hookAddr, 2n, client.address, fundParams(sig, FUTURE)))
        .to.be.revertedWithCustomError(hook, "OwnerNotRegistered");
    });

    it("reverts on an expired approval", async function () {
      const sig = await signApproval(owner, JOB, AMOUNT, PAST);
      await expect(core.fund(hookAddr, JOB, client.address, fundParams(sig, PAST)))
        .to.be.revertedWithCustomError(hook, "ApprovalExpired");
    });

    it("reverts when someone other than the owner signs", async function () {
      const sig = await signApproval(stranger, JOB, AMOUNT, FUTURE);
      await expect(core.fund(hookAddr, JOB, client.address, fundParams(sig, FUTURE)))
        .to.be.revertedWithCustomError(hook, "InvalidApprovalSignature");
    });

    it("invalidates a prior signature when the budget is raised (no escalation)", async function () {
      const sig = await signApproval(owner, JOB, AMOUNT, FUTURE); // signed for AMOUNT
      await core.setBudget(hookAddr, JOB, client.address, TOKEN, 5000n, ownerParams(owner.address)); // budget now 5000
      await expect(core.fund(hookAddr, JOB, client.address, fundParams(sig, FUTURE)))
        .to.be.revertedWithCustomError(hook, "InvalidApprovalSignature");
    });
  });

  describe("access control", function () {
    it("rejects callbacks from a non-core address", async function () {
      await expect(hook.connect(stranger).beforeAction(JOB, SEL_FUND, "0x"))
        .to.be.revertedWithCustomError(hook, "OnlyERC8183Contract");
    });
  });
});
