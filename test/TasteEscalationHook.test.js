const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TasteEscalationHook", function () {
  let hook, owner, jobManager, evaluator, other;

  beforeEach(async function () {
    [owner, jobManager, evaluator, other] = await ethers.getSigners();
    const Hook = await ethers.getContractFactory("TasteEscalationHook");
    hook = await Hook.deploy(jobManager.address, owner.address);
    await hook.waitForDeployment();
  });

  describe("deployment", function () {
    it("sets jobManager and owner", async function () {
      expect(await hook.jobManager()).to.equal(jobManager.address);
      expect(await hook.owner()).to.equal(owner.address);
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

  describe("beforeAction", function () {
    it("reverts if caller is not jobManager", async function () {
      await expect(
        hook.connect(other).beforeAction(1, "0x00000000", "0x")
      ).to.be.revertedWithCustomError(hook, "OnlyJobManager");
    });

    it("succeeds when called by jobManager", async function () {
      await expect(
        hook.connect(jobManager).beforeAction(1, "0x00000000", "0x")
      ).to.not.be.reverted;
    });
  });

  describe("afterAction — automatic rejection escalation", function () {
    const rejectSelector = ethers.id("reject(uint256,bytes32,bytes)").slice(0, 10);
    const someReason = ethers.encodeBytes32String("quality_issue");

    it("emits EscalationRequested with Rejection trigger on reject", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32", "bytes"],
        [evaluator.address, someReason, "0x"]
      );

      await expect(hook.connect(jobManager).afterAction(42, rejectSelector, data))
        .to.emit(hook, "EscalationRequested")
        .withArgs(42, evaluator.address, someReason, 0); // 0 = Rejection trigger

      const esc = await hook.getEscalation(42);
      expect(esc.status).to.equal(1); // Pending
      expect(esc.trigger).to.equal(0); // Rejection
      expect(esc.requester).to.equal(evaluator.address);
      expect(esc.originalReason).to.equal(someReason);
    });

    it("ignores non-reject selectors", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes"],
        [other.address, "0x"]
      );

      await expect(hook.connect(jobManager).afterAction(42, "0x12345678", data))
        .to.not.emit(hook, "EscalationRequested");
    });

    it("reverts on double escalation", async function () {
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32", "bytes"],
        [evaluator.address, someReason, "0x"]
      );

      await hook.connect(jobManager).afterAction(42, rejectSelector, data);
      await expect(
        hook.connect(jobManager).afterAction(42, rejectSelector, data)
      ).to.be.revertedWithCustomError(hook, "AlreadyEscalated");
    });
  });

  describe("requestReview — voluntary evaluator escalation", function () {
    const reason = ethers.encodeBytes32String("subjective_judgment");

    it("evaluator can request human review", async function () {
      await expect(hook.connect(evaluator).requestReview(99, reason))
        .to.emit(hook, "EscalationRequested")
        .withArgs(99, evaluator.address, reason, 1); // 1 = EvaluatorRequest trigger

      const esc = await hook.getEscalation(99);
      expect(esc.status).to.equal(1); // Pending
      expect(esc.trigger).to.equal(1); // EvaluatorRequest
      expect(esc.requester).to.equal(evaluator.address);
      expect(esc.originalReason).to.equal(reason);
    });

    it("anyone can request review (server validates evaluator role)", async function () {
      await expect(hook.connect(other).requestReview(99, reason))
        .to.emit(hook, "EscalationRequested");
    });

    it("cannot request review on already-escalated job", async function () {
      await hook.connect(evaluator).requestReview(99, reason);
      await expect(
        hook.connect(other).requestReview(99, reason)
      ).to.be.revertedWithCustomError(hook, "AlreadyEscalated");
    });

    it("cannot request review if already auto-escalated from rejection", async function () {
      const rejectSelector = ethers.id("reject(uint256,bytes32,bytes)").slice(0, 10);
      const data = ethers.AbiCoder.defaultAbiCoder().encode(
        ["address", "bytes32", "bytes"],
        [evaluator.address, reason, "0x"]
      );
      await hook.connect(jobManager).afterAction(99, rejectSelector, data);

      await expect(
        hook.connect(evaluator).requestReview(99, reason)
      ).to.be.revertedWithCustomError(hook, "AlreadyEscalated");
    });
  });

  describe("resolveEscalation", function () {
    const someReason = ethers.encodeBytes32String("quality_issue");

    describe("from rejection escalation", function () {
      beforeEach(async function () {
        const rejectSelector = ethers.id("reject(uint256,bytes32,bytes)").slice(0, 10);
        const data = ethers.AbiCoder.defaultAbiCoder().encode(
          ["address", "bytes32", "bytes"],
          [evaluator.address, someReason, "0x"]
        );
        await hook.connect(jobManager).afterAction(42, rejectSelector, data);
      });

      it("owner can resolve with approved", async function () {
        await expect(hook.resolveEscalation(42, true, "Provider fulfilled the brief"))
          .to.emit(hook, "EscalationResolved")
          .withArgs(42, true, "Provider fulfilled the brief");

        const esc = await hook.getEscalation(42);
        expect(esc.status).to.equal(2); // ResolvedApproved
        expect(esc.verdict).to.equal("Provider fulfilled the brief");
        expect(esc.resolvedAt).to.be.greaterThan(0);
      });

      it("owner can resolve with rejected", async function () {
        await hook.resolveEscalation(42, false, "Provider missed the brief");
        const esc = await hook.getEscalation(42);
        expect(esc.status).to.equal(3); // ResolvedRejected
      });
    });

    describe("from voluntary evaluator request", function () {
      beforeEach(async function () {
        await hook.connect(evaluator).requestReview(42, someReason);
      });

      it("owner can resolve voluntary escalation", async function () {
        await expect(hook.resolveEscalation(42, true, "Content meets the brief"))
          .to.emit(hook, "EscalationResolved");

        const esc = await hook.getEscalation(42);
        expect(esc.status).to.equal(2); // ResolvedApproved
        expect(esc.trigger).to.equal(1); // EvaluatorRequest
      });
    });

    it("non-owner cannot resolve", async function () {
      await hook.connect(evaluator).requestReview(42, someReason);
      await expect(
        hook.connect(other).resolveEscalation(42, true, "nope")
      ).to.be.revertedWithCustomError(hook, "OwnableUnauthorizedAccount");
    });

    it("cannot resolve non-pending escalation", async function () {
      await hook.connect(evaluator).requestReview(42, someReason);
      await hook.resolveEscalation(42, true, "done");
      await expect(
        hook.resolveEscalation(42, false, "again")
      ).to.be.revertedWithCustomError(hook, "NotPending");
    });

    it("cannot resolve job with no escalation", async function () {
      await expect(
        hook.resolveEscalation(999, true, "nothing here")
      ).to.be.revertedWithCustomError(hook, "NotPending");
    });
  });
});
