import { ethers } from 'ethers';

const RPC_URL = process.env.ETHEREUM_RPC_URL || '';
const CONTRACT_ADDRESS =
  process.env.SMART_CONTRACT_ADDRESS ||
  '0xE88582edFEc4CFb3B1A3ABa5A79c55B8C1d770fc';

let abiArray: ethers.InterfaceAbi = [];
try {
  abiArray = process.env.SMART_CONTRACT_ABI
    ? JSON.parse(process.env.SMART_CONTRACT_ABI)
    : [];
} catch {
  console.warn('Failed to parse SMART_CONTRACT_ABI, using empty ABI');
}

export const provider = new ethers.JsonRpcProvider(RPC_URL);

export const getContract = () =>
  new ethers.Contract(CONTRACT_ADDRESS, abiArray, provider);

export const getSignerContract = (privateKey: string) => {
  const signer = new ethers.Wallet(privateKey, provider);
  return new ethers.Contract(CONTRACT_ADDRESS, abiArray, signer);
};

export { CONTRACT_ADDRESS };
