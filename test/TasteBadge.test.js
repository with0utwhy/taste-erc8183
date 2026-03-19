const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TasteBadge", function () {
  let badge, owner, agent1, agent2, other;

  beforeEach(async function () {
    [owner, agent1, agent2, other] = await ethers.getSigners();
    const Badge = await ethers.getContractFactory("TasteBadge");
    badge = await Badge.deploy(owner.address);
    await badge.waitForDeployment();
  });

  describe("deployment", function () {
    it("sets name and symbol", async function () {
      expect(await badge.name()).to.equal("Taste Certified");
      expect(await badge.symbol()).to.equal("TASTE");
    });

    it("owner is set", async function () {
      expect(await badge.owner()).to.equal(owner.address);
    });
  });

  describe("mint", function () {
    it("mints a badge to an agent", async function () {
      await expect(badge.mint(agent1.address, "content", 10, 8))
        .to.emit(badge, "BadgeMinted");

      expect(await badge.balanceOf(agent1.address)).to.equal(1);

      const [evalCount, approvalCount, lastUpdated, active] =
        await badge.getAttestation(agent1.address, "content");
      expect(evalCount).to.equal(10);
      expect(approvalCount).to.equal(8);
      expect(lastUpdated).to.be.greaterThan(0);
      expect(active).to.be.true;
    });

    it("prevents duplicate badge for same agent+domain", async function () {
      await badge.mint(agent1.address, "content", 10, 8);
      await expect(
        badge.mint(agent1.address, "content", 15, 12)
      ).to.be.revertedWithCustomError(badge, "BadgeExists");
    });

    it("allows same agent with different domain", async function () {
      await badge.mint(agent1.address, "content", 10, 8);
      await badge.mint(agent1.address, "trust", 5, 5);
      expect(await badge.balanceOf(agent1.address)).to.equal(2);
    });

    it("only owner can mint", async function () {
      await expect(
        badge.connect(other).mint(agent1.address, "content", 10, 8)
      ).to.be.revertedWithCustomError(badge, "OwnableUnauthorizedAccount");
    });
  });

  describe("update", function () {
    beforeEach(async function () {
      await badge.mint(agent1.address, "content", 10, 8);
    });

    it("updates attestation data", async function () {
      const tokenId = await badge.getBadgeId(agent1.address, "content");
      await expect(badge.update(tokenId, 20, 16))
        .to.emit(badge, "BadgeUpdated")
        .withArgs(tokenId, 20, 16);

      const [evalCount, approvalCount] = await badge.getAttestation(agent1.address, "content");
      expect(evalCount).to.equal(20);
      expect(approvalCount).to.equal(16);
    });

    it("only owner can update", async function () {
      const tokenId = await badge.getBadgeId(agent1.address, "content");
      await expect(
        badge.connect(other).update(tokenId, 20, 16)
      ).to.be.revertedWithCustomError(badge, "OwnableUnauthorizedAccount");
    });
  });

  describe("revoke", function () {
    beforeEach(async function () {
      await badge.mint(agent1.address, "content", 10, 8);
    });

    it("revokes a badge", async function () {
      const tokenId = await badge.getBadgeId(agent1.address, "content");
      await expect(badge.revoke(tokenId))
        .to.emit(badge, "BadgeRevoked");

      expect(await badge.balanceOf(agent1.address)).to.equal(0);
      const [, , , active] = await badge.getAttestation(agent1.address, "content");
      expect(active).to.be.false;
    });

    it("cannot revoke twice", async function () {
      const tokenId = await badge.getBadgeId(agent1.address, "content");
      await badge.revoke(tokenId);
      await expect(badge.revoke(tokenId)).to.be.revertedWithCustomError(badge, "NoBadge");
    });
  });

  describe("soulbound", function () {
    beforeEach(async function () {
      await badge.mint(agent1.address, "content", 10, 8);
    });

    it("cannot transfer badge", async function () {
      const tokenId = await badge.getBadgeId(agent1.address, "content");
      await expect(
        badge.connect(agent1).transferFrom(agent1.address, agent2.address, tokenId)
      ).to.be.revertedWithCustomError(badge, "Soulbound");
    });
  });

  describe("getAttestation", function () {
    it("returns zeros for non-existent badge", async function () {
      const [evalCount, approvalCount, lastUpdated, active] =
        await badge.getAttestation(agent1.address, "nonexistent");
      expect(evalCount).to.equal(0);
      expect(approvalCount).to.equal(0);
      expect(lastUpdated).to.equal(0);
      expect(active).to.be.false;
    });
  });
});
