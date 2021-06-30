const { ethers, network } = require("hardhat");
const { expect } = require("chai");

describe("GameMining contract", function () {
  let gameMining;
  let mainToken;
  let owner;
  let alice;
  let bouncer;

  async function signMessage(signer, contract, user, timestamp, amount) {
    const dataToSign = web3.utils.soliditySha3Raw(
      contract.address,
      user.address,
      timestamp,
      amount
    );

    const signature = await signer.signMessage(
      ethers.utils.arrayify(dataToSign)
    );

    const r = "0x" + signature.substr(2, 64);
    const s = "0x" + signature.substr(66, 64);
    const v = "0x" + signature.substr(130, 2);

    return { v, r, s };
  }

  async function stakeAndAdvanceSeconds(account, amount, seconds) {
    await mainToken.mint(account.address, amount);
    await mainToken.connect(account).approve(gameMining.address, amount);

    const { blockHash } = await gameMining.connect(account).stake(amount);

    await network.provider.send("evm_increaseTime", [seconds]);

    const stakeTimestamp = await getBlockTimestamp(blockHash);
    return stakeTimestamp;
  }

  async function getBlockTimestamp(blockHash) {
    const block = await network.provider.send("eth_getBlockByHash", [
      blockHash,
      false,
    ]);

    return parseInt(block.timestamp, 16);
  }

  beforeEach(async function () {
    const TestERC20 = await ethers.getContractFactory("TestERC20");
    const GameMining = await ethers.getContractFactory("GameMining");
    [owner, alice, bouncer] = await ethers.getSigners();

    mainToken = await TestERC20.deploy();
    gameMining = await GameMining.deploy(mainToken.address);
  });

  describe("Deployment", function () {
    it("Should set the right owner", async function () {
      expect(await gameMining.owner()).to.equal(owner.address);
    });
  });

  describe("Management Behaviour", function () {
    describe("toggleGameMining()", function () {
      it("Should revert if the user is not an owner", async function () {
        await expect(
          gameMining.connect(alice).toggleGameMining()
        ).to.be.revertedWith("caller is not the owner");
      });

      it("Should activate/deactivate the contract depending on the current status", async function () {
        const activeStatus = await gameMining.active();

        await gameMining.toggleGameMining();

        expect(await gameMining.active()).to.equal(!activeStatus);

        await gameMining.toggleGameMining();

        expect(await gameMining.active()).to.equal(activeStatus);
      });
    });

    describe("depositRewardsFunds()", function () {
      it("Should revert if the user is not an owner", async function () {
        await expect(
          gameMining.connect(alice).depositRewardsFunds(123)
        ).to.be.revertedWith("caller is not the owner");
      });

      it("Should revert if the deposit amount is zero", async function () {
        await expect(gameMining.depositRewardsFunds(0)).to.be.revertedWith(
          "Deposit amount must be positive"
        );
      });

      it("Should add the deposited amount to the rewards funds of the contract", async function () {
        await mainToken.mint(owner.address, 1000);
        await mainToken.approve(gameMining.address, 1000);

        await gameMining.depositRewardsFunds(1000);

        expect(await mainToken.balanceOf(gameMining.address)).to.equal(1000);
        expect(await gameMining.rewardsFunds()).to.equal(1000);
      });
    });

    describe("withdrawRewardsFunds()", function () {
      it("Should revert if the user is not an owner", async function () {
        await expect(
          gameMining.connect(alice).withdrawRewardsFunds()
        ).to.be.revertedWith("caller is not the owner");
      });

      it("Should revert if there are no funds to withdraw", async function () {
        await expect(gameMining.withdrawRewardsFunds()).to.be.revertedWith(
          "There are no funds to withdraw"
        );
      });

      it("Should withdraw all rewards tokens from the contract", async function () {
        // Deposit some rewards tokens in the contract
        await mainToken.mint(owner.address, 1000);
        await mainToken.approve(gameMining.address, 1000);

        await gameMining.depositRewardsFunds(1000);

        await gameMining.toggleGameMining();

        // Deposit some staking tokens in the contract
        await mainToken.mint(alice.address, 1000);
        await mainToken.connect(alice).approve(gameMining.address, 1000);

        await gameMining.connect(alice).stake(1000);

        // Test the behaviour
        await gameMining.withdrawRewardsFunds();

        expect(await mainToken.balanceOf(owner.address)).to.equal(1000);
        expect(await mainToken.balanceOf(gameMining.address)).to.equal(1000);
        expect(await mainToken.balanceOf(alice.address)).to.equal(0);
      });
    });
  });

  describe("User Behaviour", function () {
    describe("stake()", function () {
      it("Should revert if game mining is not active", async function () {
        await expect(gameMining.connect(alice).stake(123)).to.be.revertedWith(
          "Game mining is not active"
        );
      });

      it("Should revert if the staking amount is zero", async function () {
        await gameMining.toggleGameMining();

        await expect(gameMining.stake(0)).to.be.revertedWith(
          "Stake amount must be positive"
        );
      });

      it("Should add the staked amount to the staked funds of the user", async function () {
        await gameMining.toggleGameMining();

        await mainToken.mint(alice.address, 1000);
        await mainToken.connect(alice).approve(gameMining.address, 1000);

        // First stake
        const { blockHash } = await gameMining.connect(alice).stake(123);

        const timestamp = await getBlockTimestamp(blockHash);

        expect(await mainToken.balanceOf(gameMining.address)).to.equal(123);
        expect(await mainToken.balanceOf(alice.address)).to.equal(1000 - 123);
        expect(await gameMining.stakedFunds()).to.equal(123);

        const aliceInfo1 = await gameMining.users(alice.address);
        expect(aliceInfo1.amountStaked).to.equal(123);
        expect(aliceInfo1.totalRewards).to.equal(0);
        expect(aliceInfo1.stakingStartTimestamp).to.equal(timestamp);

        // Second stake
        await gameMining.connect(alice).stake(456);

        expect(await mainToken.balanceOf(gameMining.address)).to.equal(
          123 + 456
        );
        expect(await mainToken.balanceOf(alice.address)).to.equal(
          1000 - 123 - 456
        );
        expect(await gameMining.stakedFunds()).to.equal(123 + 456);

        const aliceInfo2 = await gameMining.users(alice.address);
        expect(aliceInfo2.amountStaked).to.equal(123 + 456);
        expect(aliceInfo2.totalRewards).to.equal(0);
        expect(aliceInfo2.stakingStartTimestamp).to.equal(timestamp);
      });
    });

    describe("unstake()", function () {
      it("Should revert if the user has no staking funds", async function () {
        await expect(gameMining.unstake()).to.be.revertedWith(
          "There are no funds to unstake"
        );
      });

      it("Should add the staked amount back to the user balance and delete their info", async function () {
        // Deposit some staking tokens in the contract
        await gameMining.toggleGameMining();

        await mainToken.mint(alice.address, 1000);
        await mainToken.connect(alice).approve(gameMining.address, 1000);

        await gameMining.connect(alice).stake(1000);

        // Test the behaviour
        await gameMining.connect(alice).unstake();

        expect(await mainToken.balanceOf(gameMining.address)).to.equal(0);
        expect(await mainToken.balanceOf(alice.address)).to.equal(1000);
        expect(await gameMining.stakedFunds()).to.equal(0);

        const aliceInfo = await gameMining.users(alice.address);
        expect(aliceInfo.amountStaked).to.equal(0);
        expect(aliceInfo.totalRewards).to.equal(0);
        expect(aliceInfo.stakingStartTimestamp).to.equal(0);
      });
    });

    describe("claimRewards()", function () {
      it("Should revert if game mining is not active", async function () {
        const signature = await signMessage(owner, gameMining, alice, 0, 123);

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith("Game mining is not active");
      });

      it("Should revert if the user is not staking", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const signature = await signMessage(owner, gameMining, alice, 0, 123);

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith("Rewards are only for users that are staking");
      });

      it("Should revert if the user is not staking for at least 30 days", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        await stakeAndAdvanceSeconds(alice, 1000, 30 * 24 * 60 * 60 - 1);

        const signature = await signMessage(owner, gameMining, alice, 0, 123);

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith("Rewards can only be claimed after 30 days");
      });

      it("Should revert if the signer is not the bouncer", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          alice, // Wrong value
          gameMining,
          alice,
          stakeTimestamp,
          123
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith(
          "Why are you trying to steal our money? Just stop. You can't do it"
        );
      });

      it("Should revert if the message was not signed for the contract", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          bouncer,
          alice, // Wrong value
          alice,
          stakeTimestamp,
          123
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith(
          "Why are you trying to steal our money? Just stop. You can't do it"
        );
      });

      it("Should revert if the message was not signed for the message sender", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          bouncer,
          gameMining,
          owner, // Wrong value
          stakeTimestamp,
          123
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith(
          "Why are you trying to steal our money? Just stop. You can't do it"
        );
      });

      it("Should revert if the timestamp is incorrect", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          bouncer,
          gameMining,
          alice,
          stakeTimestamp - 1,
          123 // Wrong value
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith(
          "Why are you trying to steal our money? Just stop. You can't do it"
        );
      });

      it("Should revert if the amount is incorrect", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          bouncer,
          gameMining,
          alice,
          stakeTimestamp,
          123456789 // Wrong value
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith(
          "Why are you trying to steal our money? Just stop. You can't do it"
        );
      });

      it("Should revert if there are no new rewards to claim", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          bouncer,
          gameMining,
          alice,
          stakeTimestamp,
          0
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(0, signature.v, signature.r, signature.s)
        ).to.be.revertedWith("There are no new rewards to claim");
      });

      it("Should revert if there are not enough rewards funds", async function () {
        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        const signature = await signMessage(
          bouncer,
          gameMining,
          alice,
          stakeTimestamp,
          123
        );

        await expect(
          gameMining
            .connect(alice)
            .claimRewards(123, signature.v, signature.r, signature.s)
        ).to.be.revertedWith(
          "There are not enough funds for rewards. Please reach out to us"
        );
      });

      it("Should add the rewards to the user balance", async function () {
        // Deposit some rewards tokens in the contract
        await mainToken.mint(owner.address, 1000);
        await mainToken.approve(gameMining.address, 1000);

        await gameMining.depositRewardsFunds(1000);

        await gameMining.setBouncer(bouncer.address);
        await gameMining.toggleGameMining();

        const stakeTimestamp = await stakeAndAdvanceSeconds(
          alice,
          1000,
          30 * 24 * 60 * 60
        );

        // First claim
        const firstSignature = await signMessage(
          bouncer,
          gameMining,
          alice,
          stakeTimestamp,
          123
        );

        await gameMining
          .connect(alice)
          .claimRewards(
            123,
            firstSignature.v,
            firstSignature.r,
            firstSignature.s
          );

        expect((await gameMining.users(alice.address)).totalRewards).to.equal(
          123
        );
        expect(await mainToken.balanceOf(alice.address)).to.equal(123);

        expect(await gameMining.rewardsFunds()).to.equal(1000 - 123);
        expect(await mainToken.balanceOf(gameMining.address)).to.equal(
          1000 + 1000 - 123
        );

        // Second claim
        const secondSignature = await signMessage(
          bouncer,
          gameMining,
          alice,
          stakeTimestamp,
          456
        );

        await gameMining
          .connect(alice)
          .claimRewards(
            456,
            secondSignature.v,
            secondSignature.r,
            secondSignature.s
          );

        expect((await gameMining.users(alice.address)).totalRewards).to.equal(
          456
        );
        expect(await mainToken.balanceOf(alice.address)).to.equal(456);

        expect(await gameMining.rewardsFunds()).to.equal(1000 - 456);
        expect(await mainToken.balanceOf(gameMining.address)).to.equal(
          1000 + 1000 - 456
        );
      });
    });
  });
});
