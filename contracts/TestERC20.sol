// SPDX-License-Identifier: MIT

pragma solidity ^0.7.6;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// Test ERC20 token
contract TestERC20 is ERC20 {
    address public minter;

    constructor() ERC20("TEST", "TST") {
        minter = msg.sender;
    }

    function mint(address to, uint256 amount) public {
        require(msg.sender == minter, "Only minter can mint");
        _mint(to, amount);
    }
}
