// SPDX-License-Identifier: MIT
pragma solidity ^0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GameMining is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address private bouncer; // Used for allowing users to claim rewards by signing a message

    IERC20 internal immutable mainToken;

    bool public active;
    uint256 public stakedFunds; // Amount of tokens staked by the users
    uint256 public rewardsFunds; // Amount of tokens available for rewards

    struct userInfo {
        uint256 amountStaked;
        uint256 totalRewards;
        uint256 stakingStartTimestamp;
    }

    mapping(address => userInfo) public users;

    constructor(IERC20 _tokenContract) {
        mainToken = _tokenContract;
        bouncer = msg.sender;
    }

    /************************/
    /* MANAGEMENT FUNCTIONS */
    /************************/

    // The bouncer will be a hot wallet in our backend that will allow a user to withdraw a given amount of
    // tokens based on the some logic related to the platform. It will take into account the in-game bets and
    // the amount of tokens the user is staking in this contract.
    function setBouncer(address _bouncer) external onlyOwner {
        require(_bouncer != address(0), "Bouncer can't be the zero address");

        bouncer = _bouncer;
    }

    event GameMiningStatusChange(bool newStatus);

    // Enable or disable this contract's functionality. It does not include the staked funds, which always
    // belong to the user.
    function toggleGameMining() external onlyOwner {
        bool newStatus = !active;

        active = newStatus;

        emit GameMiningStatusChange(newStatus);
    }

    // Deposit funds to be given to users as rewards.
    function depositRewardsFunds(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Deposit amount must be positive");

        rewardsFunds = rewardsFunds.add(_amount);

        mainToken.safeTransferFrom(msg.sender, address(this), _amount);
    }

    // Collect any funds of the main token that are in the contract, including those that are sent
    // accidentally to it. This does not include user funds that were deposited through staking.
    function withdrawRewardsFunds() external onlyOwner {
        uint256 amountToTransfer = rewardsFunds;
        require(amountToTransfer > 0, "There are no funds to withdraw");

        rewardsFunds = 0;

        mainToken.safeTransfer(owner(), amountToTransfer);
    }

    /******************/
    /* USER FUNCTIONS */
    /******************/

    event Stake(address indexed userAddress, uint256 amount);

    // Deposit staking funds.
    function stake(uint256 _amount) external {
        require(active, "Game mining is not active");
        require(_amount > 0, "Stake amount must be positive");

        stakedFunds = stakedFunds.add(_amount);

        uint256 userStakedAmount = users[msg.sender].amountStaked;
        if (userStakedAmount == 0) {
            users[msg.sender].stakingStartTimestamp = block.timestamp;
        }
        users[msg.sender].amountStaked = userStakedAmount.add(_amount);

        mainToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit Stake(msg.sender, _amount);
    }

    event Unstake(address indexed userAddress, uint256 amount);

    // Withdraw staking funds.
    function unstake() external {
        uint256 userStakedAmount = users[msg.sender].amountStaked;
        require(userStakedAmount > 0, "There are no funds to unstake");

        stakedFunds = stakedFunds.sub(userStakedAmount);

        delete users[msg.sender];

        mainToken.safeTransfer(msg.sender, userStakedAmount);

        emit Unstake(msg.sender, userStakedAmount);
    }

    event ClaimRewards(address indexed userAddress, uint256 amount);

    // Claim the rewards as stated by the backend. The received value is the total rewards accumulated since
    // the first deposit. So, the amount to be awarded must be calculated from the new value and the one
    // stored in the contract.
    function claimRewards(
        uint256 _newTotalRewards,
        uint8 _v,
        bytes32 _r,
        bytes32 _s
    ) external {
        require(active, "Game mining is not active");

        uint256 stakingStartTimestamp = users[msg.sender].stakingStartTimestamp;
        require(
            stakingStartTimestamp != 0,
            "Rewards are only for users that are staking"
        );

        require(
            block.timestamp >= stakingStartTimestamp + 30 days,
            "Rewards can only be claimed after 30 days"
        );

        bytes32 messageHash = keccak256(
            abi.encodePacked(
                address(this),
                msg.sender,
                stakingStartTimestamp,
                _newTotalRewards
            )
        );
        require(
            bouncer ==
                ecrecover(
                    keccak256(
                        abi.encodePacked(
                            "\x19Ethereum Signed Message:\n32",
                            messageHash
                        )
                    ),
                    _v,
                    _r,
                    _s
                ),
            "Why are you trying to steal our money? Just stop. You can't do it"
        );

        uint256 userTotalRewards = users[msg.sender].totalRewards;

        require(
            _newTotalRewards > userTotalRewards,
            "There are no new rewards to claim"
        );

        uint256 amountToTransfer = _newTotalRewards.sub(userTotalRewards);

        uint256 availableRewardsFunds = rewardsFunds; // Gas optimization
        require(
            availableRewardsFunds >= amountToTransfer,
            "There are not enough funds for rewards. Please reach out to us"
        );

        users[msg.sender].totalRewards = _newTotalRewards;
        rewardsFunds = availableRewardsFunds.sub(amountToTransfer);

        mainToken.safeTransfer(msg.sender, amountToTransfer);

        emit ClaimRewards(msg.sender, amountToTransfer);
    }
}
