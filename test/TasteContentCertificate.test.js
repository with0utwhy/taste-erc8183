const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TasteContentCertificate", function () {
  let cert, owner, agent1, agent2, other;

  const sampleHash = ethers.keccak256(ethers.toUtf8Bytes("AI-generated marketing video v2.1"));
  const anotherHash = ethers.keccak256(ethers.toUtf8Bytes("Research report on DeFi yields"));

  beforeEach(async function () {
    [owner, agent1, agent2, other] = await ethers.getSigners();
    const Cert = await ethers.getContractFactory("TasteContentCertificate");
    cert = await Cert.deploy(owner.address);
    await cert.waitForDeployment();
  });

  describe("issue", function () {
    it("issues a certificate", async function () {
      await expect(
        cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative")
      )
        .to.emit(cert, "CertificateIssued")
        .withArgs(1, sampleHash, agent1.address, "content_quality_gate", "approved");

      const c = await cert.getCertificate(1);
      expect(c.contentHash).to.equal(sampleHash);
      expect(c.agent).to.equal(agent1.address);
      expect(c.offeringType).to.equal("content_quality_gate");
      expect(c.verdict).to.equal("approved");
      expect(c.domain).to.equal("creative");
      expect(c.valid).to.be.true;
      expect(c.issuedAt).to.be.greaterThan(0);
    });

    it("only owner can issue", async function () {
      await expect(
        cert.connect(other).issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative")
      ).to.be.revertedWithCustomError(cert, "OwnableUnauthorizedAccount");
    });

    it("rejects empty hash", async function () {
      await expect(
        cert.issue(ethers.ZeroHash, agent1.address, "content_quality_gate", "approved", "creative")
      ).to.be.revertedWithCustomError(cert, "EmptyHash");
    });

    it("tracks certificates per agent", async function () {
      await cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative");
      await cert.issue(anotherHash, agent1.address, "output_quality_gate", "approved_with_changes", "research");

      const ids = await cert.getAgentCertificates(agent1.address);
      expect(ids.length).to.equal(2);
      expect(ids[0]).to.equal(1);
      expect(ids[1]).to.equal(2);
    });

    it("overwrites content mapping with latest cert", async function () {
      await cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative");
      await cert.issue(sampleHash, agent2.address, "content_quality_gate", "approved", "creative");

      // Latest cert for this content hash is #2
      const [certified, certId] = await cert.verify(sampleHash);
      expect(certified).to.be.true;
      expect(certId).to.equal(2);
    });
  });

  describe("verify", function () {
    it("returns true for certified content", async function () {
      await cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative");

      const [certified, certId, verdict, issuedAt] = await cert.verify(sampleHash);
      expect(certified).to.be.true;
      expect(certId).to.equal(1);
      expect(verdict).to.equal("approved");
      expect(issuedAt).to.be.greaterThan(0);
    });

    it("returns false for uncertified content", async function () {
      const unknownHash = ethers.keccak256(ethers.toUtf8Bytes("never reviewed"));
      const [certified, certId, verdict, issuedAt] = await cert.verify(unknownHash);
      expect(certified).to.be.false;
      expect(certId).to.equal(0);
      expect(verdict).to.equal("");
      expect(issuedAt).to.equal(0);
    });

    it("returns false for revoked certificate", async function () {
      await cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative");
      await cert.revoke(1);

      const [certified] = await cert.verify(sampleHash);
      expect(certified).to.be.false;
    });
  });

  describe("revoke", function () {
    beforeEach(async function () {
      await cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative");
    });

    it("revokes a certificate", async function () {
      await expect(cert.revoke(1))
        .to.emit(cert, "CertificateRevoked")
        .withArgs(1, sampleHash);

      const c = await cert.getCertificate(1);
      expect(c.valid).to.be.false;
    });

    it("cannot revoke twice", async function () {
      await cert.revoke(1);
      await expect(cert.revoke(1)).to.be.revertedWithCustomError(cert, "InvalidCertificate");
    });

    it("only owner can revoke", async function () {
      await expect(
        cert.connect(other).revoke(1)
      ).to.be.revertedWithCustomError(cert, "OwnableUnauthorizedAccount");
    });
  });

  describe("totalCertificates", function () {
    it("tracks count", async function () {
      expect(await cert.totalCertificates()).to.equal(0);
      await cert.issue(sampleHash, agent1.address, "content_quality_gate", "approved", "creative");
      expect(await cert.totalCertificates()).to.equal(1);
      await cert.issue(anotherHash, agent2.address, "output_quality_gate", "approved", "research");
      expect(await cert.totalCertificates()).to.equal(2);
    });
  });
});
