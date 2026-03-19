const { expect } = require("chai");
const { ethers, upgrades } = require("hardhat");

describe("TasteHookRouter", function () {
  let router, ac, usdc, gatekeeper, escalation, owner, client, provider, evaluator, jobOwner;
  const ONE_USDC = 1_000_000n;

  beforeEach(async function () {
    [owner, client, provider, evaluator, jobOwner] = await ethers.getSigners();

    // Deploy MockUSDC + AgenticCommerce
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();
    await usdc.mint(client.address, 10_000n * ONE_USDC);

    const AC = await ethers.getContractFactory("AgenticCommerce");
    ac = await upgrades.deployProxy(AC, [await usdc.getAddress(), owner.address], { kind: "uups" });
    await ac.waitForDeployment();
    const acAddr = await ac.getAddress();

    // Deploy sub-hooks
    const GK = await ethers.getContractFactory("TasteGatekeeperHook");
    gatekeeper = await GK.deploy(acAddr, owner.address, 5n * ONE_USDC);
    await gatekeeper.waitForDeployment();

    const Hook = await ethers.getContractFactory("TasteEscalationHook");
    escalation = await Hook.deploy(acAddr, owner.address);
    await escalation.waitForDeployment();

    // Deploy router
    const Router = await ethers.getContractFactory("TasteHookRouter");
    router = await Router.deploy(acAddr, owner.address);
    await router.waitForDeployment();

    // IMPORTANT: sub-hooks need to accept calls from the router, not just the AC.
    // But our hooks check msg.sender == jobManager. The router calls them directly,
    // so the hooks will revert with OnlyJobManager.
    //
    // Fix: the sub-hooks' jobManager should be set to the router address.
    // For this test, we deploy fresh hooks with router as jobManager.
    const gk2 = await GK.deploy(await router.getAddress(), owner.address, 5n * ONE_USDC);
    await gk2.waitForDeployment();
    gatekeeper = gk2;

    const esc2 = await Hook.deploy(await router.getAddress(), owner.address);
    await esc2.waitForDeployment();
    escalation = esc2;

    // Whitelist the router (not the sub-hooks) on AgenticCommerce
    await ac.setHookWhitelist(await router.getAddress(), true);
  });

  describe("deployment", function () {
    it("sets jobManager and owner", async function () {
      expect(await router.jobManager()).to.equal(await ac.getAddress());
      expect(await router.owner()).to.equal(owner.address);
    });

    it("supports IACPHook interface", async function () {
      const iface = new ethers.Interface([
        "function beforeAction(uint256,bytes4,bytes)",
        "function afterAction(uint256,bytes4,bytes)",
      ]);
      const selectors = iface.fragments.map(f => iface.getFunction(f.name).selector);
      const interfaceId = BigInt(selectors[0]) ^ BigInt(selectors[1]);
      const id = "0x" + interfaceId.toString(16).padStart(8, "0");
      expect(await router.supportsInterface(id)).to.be.true;
    });

    it("starts with no sub-hooks", async function () {
      expect(await router.hookCount()).to.equal(0);
    });
  });

  describe("managing sub-hooks", function () {
    it("can add a hook for all selectors", async function () {
      await expect(router.addHook(await escalation.getAddress(), []))
        .to.emit(router, "SubHookAdded");
      expect(await router.hookCount()).to.equal(1);
    });

    it("can add a hook for specific selectors", async function () {
      const fundSelector = ethers.id("fund(uint256,bytes)").slice(0, 10);
      await router.addHook(await gatekeeper.getAddress(), [fundSelector]);
      expect(await router.hookCount()).to.equal(1);
    });

    it("can add multiple hooks", async function () {
      const fundSelector = ethers.id("fund(uint256,bytes)").slice(0, 10);
      await router.addHook(await gatekeeper.getAddress(), [fundSelector]);
      const rejectSelector = ethers.id("reject(uint256,bytes32,bytes)").slice(0, 10);
      await router.addHook(await escalation.getAddress(), [rejectSelector]);
      expect(await router.hookCount()).to.equal(2);

      const hooks = await router.getHooks();
      expect(hooks[0]).to.equal(await gatekeeper.getAddress());
      expect(hooks[1]).to.equal(await escalation.getAddress());
    });

    it("rejects non-IACPHook contracts", async function () {
      await expect(
        router.addHook(await usdc.getAddress(), [])
      ).to.be.revertedWithCustomError(router, "InvalidHook");
    });

    it("rejects duplicate hooks", async function () {
      await router.addHook(await escalation.getAddress(), []);
      await expect(
        router.addHook(await escalation.getAddress(), [])
      ).to.be.revertedWithCustomError(router, "HookAlreadyAdded");
    });

    it("can remove last hook", async function () {
      await router.addHook(await escalation.getAddress(), []);
      await expect(router.removeLastHook()).to.emit(router, "SubHookRemoved");
      expect(await router.hookCount()).to.equal(0);
    });

    it("only owner can add hooks", async function () {
      await expect(
        router.connect(client).addHook(await escalation.getAddress(), [])
      ).to.be.revertedWithCustomError(router, "OwnableUnauthorizedAccount");
    });
  });

  describe("routing — gatekeeper on fund", function () {
    beforeEach(async function () {
      // Add gatekeeper for fund + setBudget selectors
      const fundSelector = ethers.id("fund(uint256,bytes)").slice(0, 10);
      const setBudgetSelector = ethers.id("setBudget(uint256,uint256,bytes)").slice(0, 10);
      await router.addHook(await gatekeeper.getAddress(), [fundSelector, setBudgetSelector]);
    });

    it("blocks fund() via routed gatekeeper", async function () {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await ac.connect(client).createJob(
        provider.address, evaluator.address, expiry,
        "Test job", await router.getAddress()
      );
      const jobId = await ac.jobCounter();

      // setBudget with owner in optParams
      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [jobOwner.address]);
      await ac.connect(provider).setBudget(jobId, 10n * ONE_USDC, optParams);

      await usdc.connect(client).approve(await ac.getAddress(), 10n * ONE_USDC);

      // fund should revert — gatekeeper blocks
      await expect(
        ac.connect(client).fund(jobId, "0x")
      ).to.be.revertedWithCustomError(gatekeeper, "AwaitingHumanApproval");
    });

    it("allows fund() after gatekeeper approval", async function () {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await ac.connect(client).createJob(
        provider.address, evaluator.address, expiry,
        "Test job", await router.getAddress()
      );
      const jobId = await ac.jobCounter();

      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [jobOwner.address]);
      await ac.connect(provider).setBudget(jobId, 10n * ONE_USDC, optParams);
      await usdc.connect(client).approve(await ac.getAddress(), 10n * ONE_USDC);

      // Approve via gatekeeper
      await gatekeeper.connect(jobOwner).approveJob(jobId, "Looks good");

      // Now fund works
      await expect(ac.connect(client).fund(jobId, "0x")).to.not.be.reverted;
    });
  });

  describe("routing — escalation on reject", function () {
    beforeEach(async function () {
      const rejectSelector = ethers.id("reject(uint256,bytes32,bytes)").slice(0, 10);
      await router.addHook(await escalation.getAddress(), [rejectSelector]);
    });

    it("fires escalation hook on reject", async function () {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await ac.connect(client).createJob(
        provider.address, evaluator.address, expiry,
        "Test job", await router.getAddress()
      );
      const jobId = await ac.jobCounter();

      // Fund with 0 budget (skip gatekeeper)
      await ac.connect(provider).setBudget(jobId, 0, "0x");
      await ac.connect(client).fund(jobId, "0x");

      // Submit
      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("work"));
      await ac.connect(provider).submit(jobId, deliverable, "0x");

      // Reject — should trigger escalation via router
      const reason = ethers.encodeBytes32String("bad_work");
      await expect(
        ac.connect(evaluator).reject(jobId, reason, "0x")
      ).to.emit(escalation, "EscalationRequested");

      // Verify escalation was recorded
      const esc = await escalation.getEscalation(jobId);
      expect(esc.status).to.equal(1); // Pending
    });
  });

  describe("routing — both hooks on same job", function () {
    beforeEach(async function () {
      const fundSelector = ethers.id("fund(uint256,bytes)").slice(0, 10);
      const setBudgetSelector = ethers.id("setBudget(uint256,uint256,bytes)").slice(0, 10);
      const rejectSelector = ethers.id("reject(uint256,bytes32,bytes)").slice(0, 10);

      await router.addHook(await gatekeeper.getAddress(), [fundSelector, setBudgetSelector]);
      await router.addHook(await escalation.getAddress(), [rejectSelector]);
    });

    it("full lifecycle: gatekeeper blocks → approve → fund → submit → reject → escalation", async function () {
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
      await ac.connect(client).createJob(
        provider.address, evaluator.address, expiry,
        "Full test", await router.getAddress()
      );
      const jobId = await ac.jobCounter();

      // Set budget with owner
      const optParams = ethers.AbiCoder.defaultAbiCoder().encode(["address"], [jobOwner.address]);
      await ac.connect(provider).setBudget(jobId, 10n * ONE_USDC, optParams);
      await usdc.connect(client).approve(await ac.getAddress(), 10n * ONE_USDC);

      // Gatekeeper blocks
      await expect(ac.connect(client).fund(jobId, "0x"))
        .to.be.revertedWithCustomError(gatekeeper, "AwaitingHumanApproval");

      // Owner approves
      await gatekeeper.connect(jobOwner).approveJob(jobId, "OK");

      // Fund succeeds
      await ac.connect(client).fund(jobId, "0x");

      // Submit
      const deliverable = ethers.keccak256(ethers.toUtf8Bytes("work"));
      await ac.connect(provider).submit(jobId, deliverable, "0x");

      // Reject — triggers escalation
      const reason = ethers.encodeBytes32String("not_good_enough");
      await expect(ac.connect(evaluator).reject(jobId, reason, "0x"))
        .to.emit(escalation, "EscalationRequested");

      // Both hooks worked on the same job
      const review = await gatekeeper.getReview(jobId);
      expect(review.status).to.equal(1); // Approved

      const esc = await escalation.getEscalation(jobId);
      expect(esc.status).to.equal(1); // Pending
    });
  });
});
