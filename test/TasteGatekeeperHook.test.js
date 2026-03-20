const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TasteGatekeeperHook", function () {
  let hook, ac, usdc, admin, client, provider, evaluator, jobOwner;
  const ONE_USDC = 1_000_000n; // 6 decimals

  beforeEach(async function () {
    [admin, client, provider, evaluator, jobOwner] = await ethers.getSigners();

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Mint USDC to client
    await usdc.mint(client.address, 10_000n * ONE_USDC);

    // Deploy AgenticCommerce proxy
    const AC = await ethers.getContractFactory("AgenticCommerce");
    ac = await upgrades.deployProxy(AC, [await usdc.getAddress(), admin.address], { kind: "uups" });
    await ac.waitForDeployment();

    // Deploy gatekeeper hook (admin = Taste, auto-approve below 5 USDC)
    const Hook = await ethers.getContractFactory("TasteGatekeeperHook");
    hook = await Hook.deploy(await ac.getAddress(), admin.address, 5n * ONE_USDC, 1800n);
    await hook.waitForDeployment();

    // Whitelist hook
    await ac.setHookWhitelist(await hook.getAddress(), true);
  });

  async function createTestJob(budget = 10n * ONE_USDC, owner = jobOwner.address) {
    const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
    const hookAddr = await hook.getAddress();

    // Client creates job
    await ac.connect(client).createJob(
      provider.address, evaluator.address, expiry,
      "Review my AI content", hookAddr
    );
    const jobId = await ac.jobCounter();

    // Provider sets budget with optParams = abi.encode(ownerAddress)
    const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [owner]);
    await ac.connect(provider).setBudget(jobId, budget, optParams);

    // Client approves USDC spending
    await usdc.connect(client).approve(await ac.getAddress(), budget);

    return jobId;
  }

  describe("deployment", function () {
    it("sets jobManager, admin, and threshold", async function () {
      expect(await hook.jobManager()).to.equal(await ac.getAddress());
      expect(await hook.owner()).to.equal(admin.address);
      expect(await hook.autoApproveBelow()).to.equal(5n * ONE_USDC);
    });

    it("supports IACPHook interface", async function () {
      const iface = new ethers.Interface([
        "function beforeAction(uint256,bytes4,bytes)",
        "function afterAction(uint256,bytes4,bytes)",
      ]);
      const selectors = iface.fragments.map(f => iface.getFunction(f.name).selector);
      const interfaceId = BigInt(selectors[0]) ^ BigInt(selectors[1]);
      const id = "0x" + interfaceId.toString(16).padStart(8, "0");
      expect(await hook.supportsInterface(id)).to.be.true;
    });
  });

  describe("trustless ownership — job owner from optParams", function () {
    it("extracts owner from setBudget optParams", async function () {
      const jobId = await createTestJob(10n * ONE_USDC, jobOwner.address);
      const review = await hook.getReview(jobId);
      expect(review.jobOwner).to.equal(jobOwner.address);
    });

    it("emits GatekeeperReviewRequested with jobOwner", async function () {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const hookAddr = await hook.getAddress();
      await ac.connect(client).createJob(
        provider.address, evaluator.address, expiry,
        "Review content", hookAddr
      );
      const jobId = await ac.jobCounter();

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [jobOwner.address]);
      await expect(
        ac.connect(provider).setBudget(jobId, 10n * ONE_USDC, optParams)
      ).to.emit(hook, "GatekeeperReviewRequested")
        .withArgs(jobId, jobOwner.address, provider.address, 10n * ONE_USDC);
    });

    it("falls back to client if no owner in optParams", async function () {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
      const hookAddr = await hook.getAddress();
      await ac.connect(client).createJob(
        provider.address, evaluator.address, expiry,
        "Review content", hookAddr
      );
      const jobId = await ac.jobCounter();

      // Empty optParams
      await ac.connect(provider).setBudget(jobId, 10n * ONE_USDC, "0x");
      const review = await hook.getReview(jobId);
      // Falls back to caller (provider in this case, since provider calls setBudget)
      expect(review.jobOwner).to.equal(provider.address);
    });
  });

  describe("gatekeeper flow — trustless approval", function () {
    it("reverts fund() when pending", async function () {
      const jobId = await createTestJob(10n * ONE_USDC);
      await expect(
        ac.connect(client).fund(jobId, "0x")
      ).to.be.revertedWithCustomError(hook, "AwaitingHumanApproval");
    });

    it("job owner can approve", async function () {
      const jobId = await createTestJob(10n * ONE_USDC);

      await expect(hook.connect(jobOwner).approveJob(jobId, "Looks good"))
        .to.emit(hook, "JobApproved")
        .withArgs(jobId, jobOwner.address, "Looks good");

      // Now fund succeeds
      await expect(ac.connect(client).fund(jobId, "0x")).to.not.be.reverted;
    });

    it("job owner can deny", async function () {
      const jobId = await createTestJob(10n * ONE_USDC);

      await expect(hook.connect(jobOwner).denyJob(jobId, "Too expensive"))
        .to.emit(hook, "JobDenied")
        .withArgs(jobId, jobOwner.address, "Too expensive");

      await expect(
        ac.connect(client).fund(jobId, "0x")
      ).to.be.revertedWithCustomError(hook, "JobDeniedByHuman");
    });

    it("admin (Taste) CANNOT approve jobs", async function () {
      const jobId = await createTestJob(10n * ONE_USDC);
      await expect(
        hook.connect(admin).approveJob(jobId, "admin trying")
      ).to.be.revertedWithCustomError(hook, "OnlyJobOwner");
    });

    it("random address CANNOT approve jobs", async function () {
      const jobId = await createTestJob(10n * ONE_USDC);
      await expect(
        hook.connect(client).approveJob(jobId, "not my job")
      ).to.be.revertedWithCustomError(hook, "OnlyJobOwner");
    });
  });

  describe("auto-approve threshold", function () {
    it("auto-approves jobs below threshold", async function () {
      const jobId = await createTestJob(3n * ONE_USDC);
      const review = await hook.getReview(jobId);
      expect(review.status).to.equal(1); // Approved
      await expect(ac.connect(client).fund(jobId, "0x")).to.not.be.reverted;
    });

    it("requires review for jobs at or above threshold", async function () {
      const jobId = await createTestJob(5n * ONE_USDC);
      await expect(
        ac.connect(client).fund(jobId, "0x")
      ).to.be.revertedWithCustomError(hook, "AwaitingHumanApproval");
    });

    it("admin can change threshold", async function () {
      await hook.setAutoApproveBelow(20n * ONE_USDC);
      expect(await hook.autoApproveBelow()).to.equal(20n * ONE_USDC);
    });
  });

  describe("full lifecycle", function () {
    it("create → setBudget → (blocked) → owner approves → fund → submit → complete", async function () {
      const jobId = await createTestJob(10n * ONE_USDC);

      // Blocked
      await expect(ac.connect(client).fund(jobId, "0x"))
        .to.be.revertedWithCustomError(hook, "AwaitingHumanApproval");

      // Job owner approves (not Taste!)
      await hook.connect(jobOwner).approveJob(jobId, "Approved by agent owner");

      // Fund succeeds
      await ac.connect(client).fund(jobId, "0x");

      // Submit
      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("final deliverable"));
      await ac.connect(provider).submit(jobId, deliverable, "0x");

      // Complete
      const reason = ethers.keccak256(ethers.toUtf8Bytes("quality_approved"));
      await ac.connect(evaluator).complete(jobId, reason, "0x");

      const job = await ac.getJob(jobId);
      expect(job.status).to.equal(3); // Completed
    });
  });
});
